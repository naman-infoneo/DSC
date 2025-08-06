const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');
const { exec } = require('child_process');
const pkcs11js = require('pkcs11js');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

class USBTokenManager {
    constructor() {
        // Common PKCS#11 library paths for different platforms
        this.pkcs11Libraries = [
            // Windows paths
            'C:\\Windows\\System32\\eTPKCS11.dll',       // SafeNet eToken
            'C:\\Windows\\System32\\w32pk2ig.dll',       // Gemalto
            'C:\\Windows\\System32\\dkck232.dll',        // Datakey
            'C:\\Windows\\System32\\acpkcs211.dll',      // Aladdin
            'C:\\Windows\\System32\\eps2003csp11.dll',   // Rainbow
            
            // Linux paths
            '/usr/lib/libeToken.so',
            '/usr/lib/libpkcs11.so',
            '/usr/local/lib/libpkcs11.so',
            '/usr/lib/softhsm/libsofthsm2.so',           // SoftHSM for testing
            
            // macOS paths
            '/usr/local/lib/libeToken.dylib',
            '/usr/lib/libpkcs11.dylib'
        ];
        
        this.mockTokens = [
            {
                type: 'mock_usb',
                name: 'Simulated USB Token (eToken Pro)',
                id: 'mock_token_1',
                serial: 'SIM123456'
            }
        ];
        
        console.log('🔧 USB Token Manager initialized with pkcs11js');
    }

    async detectTokens() {
        const tokens = [];
        
        // Scan for real PKCS#11 tokens
        for (const libPath of this.pkcs11Libraries) {
            if (fs.existsSync(libPath)) {
                try {
                    const libraryTokens = await this.scanPKCS11Library(libPath);
                    tokens.push(...libraryTokens);
                    console.log(`✅ Found ${libraryTokens.length} tokens in ${libPath}`);
                } catch (error) {
                    console.log(`❌ Failed to scan ${libPath}: ${error.message}`);
                }
            }
        }

        // Windows smart card detection
        if (process.platform === 'win32') {
            try {
                const smartCardTokens = await this.detectWindowsReaders();
                tokens.push(...smartCardTokens);
            } catch (error) {
                console.log('Windows reader detection failed:', error.message);
            }
        }

        // Return real tokens if found, otherwise return mock tokens
        return tokens.length > 0 ? tokens : this.mockTokens;
    }

    async scanPKCS11Library(libraryPath) {
        return new Promise((resolve) => {
            try {
                const pkcs11 = new pkcs11js.PKCS11();
                pkcs11.load(libraryPath);
                pkcs11.C_Initialize();

                const slots = pkcs11.C_GetSlotList(true);
                const tokens = [];

                for (const slot of slots) {
                    try {
                        const slotInfo = pkcs11.C_GetSlotInfo(slot);
                        const tokenInfo = pkcs11.C_GetTokenInfo(slot);
                        
                        tokens.push({
                            type: 'pkcs11',
                            name: `🔐 ${tokenInfo.label.trim()}`,
                            id: `pkcs11_slot_${slot}`,
                            slot: slot,
                            library: libraryPath,
                            serial: tokenInfo.serialNumber.trim(),
                            manufacturer: tokenInfo.manufacturerID.trim(),
                            model: tokenInfo.model.trim(),
                            detected: true
                        });
                    } catch (slotError) {
                        console.log(`Failed to get info for slot ${slot}:`, slotError.message);
                    }
                }

                pkcs11.C_Finalize();
                resolve(tokens);
            } catch (error) {
                console.log(`PKCS11 library error for ${libraryPath}:`, error.message);
                resolve([]);
            }
        });
    }

    async readCertificateFromToken(tokenInfo, password) {
        if (tokenInfo.type === 'pkcs11') {
            return this.readFromPKCS11Token(tokenInfo, password);
        } else {
            // Fallback to static certificate or mock
            return this.readStaticCertificate();
        }
    }

    async readFromPKCS11Token(tokenInfo, password) {
        try {
            const pkcs11 = new pkcs11js.PKCS11();
            pkcs11.load(tokenInfo.library);
            pkcs11.C_Initialize();

            const session = pkcs11.C_OpenSession(tokenInfo.slot, 
                pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION);
            
            // Login with PIN/password
            pkcs11.C_Login(session, pkcs11js.CKU_USER, password);

            // Find certificate objects
            const template = [
                { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_CERTIFICATE }
            ];
            
            pkcs11.C_FindObjectsInit(session, template);
            const objects = pkcs11.C_FindObjects(session, 1);
            
            if (objects.length > 0) {
                const certValue = pkcs11.C_GetAttributeValue(session, objects[0], [
                    { type: pkcs11js.CKA_VALUE }
                ]);
                
                pkcs11.C_FindObjectsFinal(session);
                pkcs11.C_Logout(session);
                pkcs11.C_CloseSession(session);
                pkcs11.C_Finalize();
                
                return certValue[0].value;
            } else {
                throw new Error('No certificate found on token');
            }
        } catch (error) {
            throw new Error(`Failed to read from PKCS#11 token: ${error.message}`);
        }
    }

    readStaticCertificate() {
        const certPath = './certificate.pfx';
        if (fs.existsSync(certPath)) {
            return fs.readFileSync(certPath);
        }
        throw new Error('No certificate available');
    }
}
// Initialize USB Token Manager
const usbTokenManager = new USBTokenManager();

// Get available certificates
app.get('/certificates', async (req, res) => {
    try {
        const certificates = [];
        
        // Add static certificate option
        if (fs.existsSync('./certificate.pfx')) {
            certificates.push({
                type: 'static',
                name: '📄 Static Certificate (PFX File)',
                path: './certificate.pfx',
                id: 'static_cert'
            });
        }
        
        // Add USB token simulations
        const tokens = await usbTokenManager.detectTokens();
        tokens.forEach(token => {
            let icon = '🔐';
            if (token.type === 'mock_smartcard' || token.type === 'windows_reader') icon = '💳';
            
            certificates.push({
                ...token,
                name: `${icon} ${token.name}`
            });
        });
        
        res.json({ 
            certificates,
            message: `Found ${certificates.length} certificate source(s)`,
            mode: 'simulation'
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to get certificates: ' + error.message,
            certificates: []
        });
    }
});

// Sign PDF
app.post('/sign', upload.single('pdf'), async (req, res) => {
    try {
        const { certificateId, certificateType, password } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }
        
        if (!password) {
            return res.status(400).json({ error: 'Certificate password is required' });
        }
        
        console.log(`🖊️ Signing request for certificate: ${certificateId}`);
        
        const pdfBuffer = fs.readFileSync(req.file.path);
        const placeholderPdf = plainAddPlaceholder({ pdfBuffer });
        
        let p12Buffer;
        
        if (certificateType === 'static') {
            // Use static certificate
            if (!fs.existsSync('./certificate.pfx')) {
                return res.status(400).json({ error: 'Static certificate file not found' });
            }
            p12Buffer = fs.readFileSync('./certificate.pfx');
            console.log('📄 Using static certificate');
            
        } else {
            // Use USB token (simulated)
            const tokens = await usbTokenManager.detectTokens();
            const selectedToken = tokens.find(token => token.id === certificateId);
            
            if (!selectedToken) {
                return res.status(400).json({ error: 'Selected token not found' });
            }
            
            console.log(`🔐 Using USB token: ${selectedToken.name}`);
            p12Buffer = await usbTokenManager.readCertificateFromToken(selectedToken, password);
        }
        
        // Sign the PDF
        let signedPdf;
        try {
            signedPdf = signer.sign(placeholderPdf, p12Buffer, { 
                passphrase: password 
            });
            console.log('✅ PDF signed successfully');
        } catch (signError) {
            console.error('❌ Signing failed:', signError.message);
            throw new Error(`Signing failed: ${signError.message}`);
        }
        
        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);
        
        res.type('application/pdf');
        res.send(signedPdf);
        
    } catch (err) {
        console.error('❌ Signing error:', err);
        
        // Cleanup uploaded file if exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ error: 'Signing error: ' + err.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        mode: 'simulation',
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        staticCertAvailable: fs.existsSync('./certificate.pfx')
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log(`📋 Platform: ${process.platform}`);
    console.log(`🔧 Mode: USB Token Simulation`);
    console.log(`📄 Static Certificate: ${fs.existsSync('./certificate.pfx') ? '✅ Available' : '❌ Missing'}`);
    
    if (!fs.existsSync('./certificate.pfx')) {
        console.log(`⚠️  Place your certificate.pfx file in the backend directory for testing`);
    }
});
