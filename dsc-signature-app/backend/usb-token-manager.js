const pkcs11 = require('pkcs11js');
const forge = require('node-forge');
const winston = require('winston');

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'usb-token.log' }),
    new winston.transports.Console()
  ],
});

class USBTokenManager {
  constructor() {
    this.pkcs11Module = null;
    this.session = null;
    this.isInitialized = false;
    
    // Common PKCS#11 library paths for different token manufacturers
    this.libraryPaths = {
      windows: [
        'C:\\Windows\\System32\\eTPKCS11.dll',           // eToken
        'C:\\Windows\\System32\\aetpkss1.dll',           // SafeNet
        'C:\\Windows\\System32\\cryptoki.dll',           // Generic
        'C:\\Windows\\System32\\w32pk2ig.dll',           // Gemalto
        'C:\\Program Files\\HID Global\\ActivClient\\acpkcs211.dll', // ActivIdentity
        'C:\\Windows\\System32\\dkck201.dll',            // Datakey
        'C:\\Windows\\System32\\sadaptor.dll',           // SecureMetrics
      ],
      linux: [
        '/usr/lib/libeTPkcs11.so',                       // eToken
        '/usr/lib/x86_64-linux-gnu/libeTPkcs11.so',
        '/usr/lib/opensc-pkcs11.so',                     // OpenSC
        '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so',
        '/usr/lib/libacpkcs211.so',                      // ActivIdentity
        '/usr/lib/x86_64-linux-gnu/libacpkcs211.so',
      ],
      macos: [
        '/usr/local/lib/libeTPkcs11.dylib',              // eToken
        '/usr/local/lib/opensc-pkcs11.so',               // OpenSC
        '/Library/Frameworks/eToken.framework/Versions/Current/libeTPkcs11.dylib',
      ]
    };
  }

  // Detect and initialize PKCS#11 libraries
  async initialize() {
    if (this.isInitialized) return true;

    const platform = process.platform;
    let paths = [];
    
    switch (platform) {
      case 'win32':
        paths = this.libraryPaths.windows;
        break;
      case 'linux':
        paths = this.libraryPaths.linux;
        break;
      case 'darwin':
        paths = this.libraryPaths.macos;
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    for (const path of paths) {
      try {
        logger.info(`Trying to load PKCS#11 library: ${path}`);
        this.pkcs11Module = pkcs11.load(path);
        this.pkcs11Module.C_Initialize();
        this.isInitialized = true;
        logger.info(`Successfully loaded PKCS#11 library: ${path}`);
        return true;
      } catch (error) {
        logger.warn(`Failed to load ${path}: ${error.message}`);
        continue;
      }
    }
    
    throw new Error('No compatible PKCS#11 library found');
  }

  // Detect available USB tokens
  async detectTokens() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const slots = this.pkcs11Module.C_GetSlotList(true); // true = only slots with tokens
      const tokens = [];

      for (const slot of slots) {
        try {
          const tokenInfo = this.pkcs11Module.C_GetTokenInfo(slot);
          const slotInfo = this.pkcs11Module.C_GetSlotInfo(slot);
          
          tokens.push({
            slotId: slot,
            label: tokenInfo.label.trim(),
            manufacturerID: tokenInfo.manufacturerID.trim(),
            model: tokenInfo.model.trim(),
            serialNumber: tokenInfo.serialNumber.trim(),
            slotDescription: slotInfo.slotDescription.trim(),
            isHardwareSlot: !!(slotInfo.flags & pkcs11.CKF_HW_SLOT),
            isTokenPresent: !!(slotInfo.flags & pkcs11.CKF_TOKEN_PRESENT),
            maxSessionCount: tokenInfo.ulMaxSessionCount,
            sessionCount: tokenInfo.ulSessionCount,
            flags: tokenInfo.flags
          });
        } catch (error) {
          logger.warn(`Error getting info for slot ${slot}: ${error.message}`);
        }
      }

      return tokens;
    } catch (error) {
      logger.error(`Error detecting tokens: ${error.message}`);
      throw error;
    }
  }

  // Open session with token
  async openSession(slotId, pin) {
    try {
      // Open session
      this.session = this.pkcs11Module.C_OpenSession(slotId, pkcs11.CKF_SERIAL_SESSION | pkcs11.CKF_RW_SESSION);
      
      // Login with PIN
      this.pkcs11Module.C_Login(this.session, pkcs11.CKU_USER, pin);
      
      logger.info(`Session opened successfully for slot ${slotId}`);
      return this.session;
    } catch (error) {
      logger.error(`Error opening session: ${error.message}`);
      throw new Error(`Failed to open session: ${error.message}`);
    }
  }

  // Find certificates on token
  async findCertificates(session = this.session) {
    try {
      // Find certificate objects
      this.pkcs11Module.C_FindObjectsInit(session, [
        { type: pkcs11.CKA_CLASS, value: pkcs11.CKO_CERTIFICATE },
        { type: pkcs11.CKA_CERTIFICATE_TYPE, value: pkcs11.CKC_X_509 }
      ]);

      const certificates = [];
      let objects = this.pkcs11Module.C_FindObjects(session);
      
      while (objects.length > 0) {
        for (const obj of objects) {
          try {
            const attrs = this.pkcs11Module.C_GetAttributeValue(session, obj, [
              { type: pkcs11.CKA_VALUE },
              { type: pkcs11.CKA_LABEL },
              { type: pkcs11.CKA_ID }
            ]);

            const certDer = attrs[0].value;
            const label = attrs[1].value ? attrs[1].value.toString() : 'Unknown';
            const id = attrs[2].value;

            // Parse certificate using node-forge
            const asn1Cert = forge.asn1.fromDer(certDer.toString('binary'));
            const cert = forge.pki.certificateFromAsn1(asn1Cert);

            certificates.push({
              handle: obj,
              label: label,
              id: id,
              certificate: cert,
              derData: certDer,
              subject: cert.subject.attributes.map(attr => `${attr.shortName}=${attr.value}`).join(', '),
              issuer: cert.issuer.attributes.map(attr => `${attr.shortName}=${attr.value}`).join(', '),
              serialNumber: cert.serialNumber,
              validFrom: cert.validity.notBefore,
              validTo: cert.validity.notAfter
            });
          } catch (error) {
            logger.warn(`Error processing certificate object ${obj}: ${error.message}`);
          }
        }
        objects = this.pkcs11Module.C_FindObjects(session);
      }

      this.pkcs11Module.C_FindObjectsFinal(session);
      return certificates;
    } catch (error) {
      logger.error(`Error finding certificates: ${error.message}`);
      throw error;
    }
  }

  // Find private key corresponding to certificate
  async findPrivateKey(session, certificateId) {
    try {
      this.pkcs11Module.C_FindObjectsInit(session, [
        { type: pkcs11.CKA_CLASS, value: pkcs11.CKO_PRIVATE_KEY },
        { type: pkcs11.CKA_ID, value: certificateId }
      ]);

      const objects = this.pkcs11Module.C_FindObjects(session);
      this.pkcs11Module.C_FindObjectsFinal(session);

      if (objects.length === 0) {
        throw new Error('Private key not found for certificate');
      }

      return objects[0];
    } catch (error) {
      logger.error(`Error finding private key: ${error.message}`);
      throw error;
    }
  }

  // Sign data using token
  async signData(session, privateKeyHandle, data, mechanism = pkcs11.CKM_SHA256_RSA_PKCS) {
    try {
      // Initialize signing operation
      this.pkcs11Module.C_SignInit(session, { mechanism: mechanism }, privateKeyHandle);
      
      // Sign the data
      const signature = this.pkcs11Module.C_Sign(session, data);
      
      return signature;
    } catch (error) {
      logger.error(`Error signing data: ${error.message}`);
      throw error;
    }
  }

  // Create PKCS#12 structure for node-signpdf compatibility
  async createPKCS12Structure(session, certificate, privateKeyHandle, password = '') {
    try {
      // Create a temporary PKCS#12 structure
      // Note: This is a simplified approach - in practice, you might need to
      // integrate directly with the signing library
      
      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
        certificate.certificate,
        null, // Private key (we'll handle signing separately)
        password,
        {
          generateLocalKeyId: true,
          friendlyName: certificate.label
        }
      );

      const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
      return Buffer.from(p12Der, 'binary');
    } catch (error) {
      logger.error(`Error creating PKCS#12 structure: ${error.message}`);
      throw error;
    }
  }

  // Close session
  closeSession() {
    if (this.session) {
      try {
        this.pkcs11Module.C_Logout(this.session);
        this.pkcs11Module.C_CloseSession(this.session);
        this.session = null;
        logger.info('Session closed successfully');
      } catch (error) {
        logger.warn(`Error closing session: ${error.message}`);
      }
    }
  }

  // Cleanup
  cleanup() {
    this.closeSession();
    if (this.pkcs11Module && this.isInitialized) {
      try {
        this.pkcs11Module.C_Finalize();
        this.isInitialized = false;
        logger.info('PKCS#11 module finalized');
      } catch (error) {
        logger.warn(`Error finalizing PKCS#11: ${error.message}`);
      }
    }
  }
}

module.exports = USBTokenManager;