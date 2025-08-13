const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');

// FIXED IMPORTS - Use correct signpdf structure
const signpdf = require('@signpdf/signpdf');
const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');
const { P12Signer } = require('@signpdf/signer-p12');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

class HardwareTokenManager {
    constructor() {
        console.log('🔧 Hardware Token Manager initialized');
        this.pkcs11Libraries = this.detectPKCS11Libraries();
    }

    // Detect common PKCS11 libraries on Windows
    detectPKCS11Libraries() {
        const commonLibraries = [
            // mToken CryptoID paths
            'C:\\Windows\\System32\\mTokenPKCS11.dll',
            'C:\\Program Files\\mToken\\mTokenPKCS11.dll',
            'C:\\Program Files (x86)\\mToken\\mTokenPKCS11.dll',
            
            // SafeNet paths
            'C:\\Windows\\System32\\eTPKCS11.dll',
            'C:\\Program Files\\SafeNet\\Authentication\\SAC\\x64\\eTPKCS11.dll',
            'C:\\Program Files (x86)\\SafeNet\\Authentication\\SAC\\x32\\eTPKCS11.dll',
            
            // Generic Windows CryptoAPI bridge
            'C:\\Windows\\System32\\cryptui.dll'
        ];

        const availableLibraries = [];
        
        for (const lib of commonLibraries) {
            if (fs.existsSync(lib)) {
                availableLibraries.push(lib);
                console.log(`✅ Found PKCS11 library: ${lib}`);
            }
        }

        if (availableLibraries.length === 0) {
            console.log('❌ No PKCS11 libraries found');
        }

        return availableLibraries;
    }

    // Get certificates from Windows Certificate Store (enhanced)
    async getCertificatesFromWindowsStore() {
        return new Promise((resolve) => {
            // Use a properly formatted PowerShell script
            const psScript = `
try {
    $certs = Get-ChildItem -Path "Cert:\\CurrentUser\\My" -ErrorAction Stop | Where-Object { $_.HasPrivateKey -eq $true }
    
    if ($certs) {
        $certArray = @()
        foreach ($cert in $certs) {
            $isExportable = $true
            $providerName = "Unknown"
            $keyContainerName = "Unknown"
            
            try {
                $privateKey = $cert.PrivateKey
                if ($privateKey) {
                    $isExportable = $privateKey.CspKeyContainerInfo.Exportable
                    $providerName = $privateKey.CspKeyContainerInfo.ProviderName
                    $keyContainerName = $privateKey.CspKeyContainerInfo.KeyContainerName
                }
            } catch {
                $isExportable = $false
                $providerName = "Hardware Token"
            }
            
            $certObj = @{
                Subject = $cert.Subject
                Thumbprint = $cert.Thumbprint
                NotAfter = $cert.NotAfter.ToString("yyyy-MM-dd HH:mm:ss")
                Issuer = $cert.Issuer
                FriendlyName = $cert.FriendlyName
                SerialNumber = $cert.SerialNumber
                IsExportable = $isExportable
                Provider = $providerName
                KeyContainer = $keyContainerName
            }
            $certArray += $certObj
        }
        $certArray | ConvertTo-Json -Depth 2
    } else {
        Write-Output "[]"
    }
} catch {
    Write-Error "PowerShell Error: $($_.Exception.Message)"
}`;

            // Write script to temporary file to avoid command line issues
            const tempScriptPath = path.join(__dirname, `temp_script_${Date.now()}.ps1`);
            
            try {
                fs.writeFileSync(tempScriptPath, psScript, 'utf8');
                
                // Execute the script file instead of inline command
                exec(`powershell -ExecutionPolicy Bypass -File "${tempScriptPath}"`, 
                    { timeout: 10000 }, (error, stdout, stderr) => {
                    
                    // Clean up temp script file
                    if (fs.existsSync(tempScriptPath)) {
                        fs.unlinkSync(tempScriptPath);
                    }
                    
                    if (error) {
                        console.log('PowerShell error:', error.message);
                        resolve([]);
                        return;
                    }

                    try {
                        const cleanOutput = stdout.trim();
                        if (!cleanOutput) {
                            resolve([]);
                            return;
                        }

                        const certs = JSON.parse(cleanOutput);
                        const certArray = Array.isArray(certs) ? certs : [certs];
                        
                        const formattedCerts = certArray
                            .filter(cert => cert && cert.Thumbprint)
                            .map((cert) => ({
                                type: 'windows_cert_store',
                                name: `🔐 ${this.extractCNFromSubject(cert.Subject)}`,
                                id: `cert_${cert.Thumbprint}`,
                                thumbprint: cert.Thumbprint,
                                subject: cert.Subject,
                                issuer: cert.Issuer,
                                expiry: cert.NotAfter,
                                friendlyName: cert.FriendlyName,
                                serialNumber: cert.SerialNumber,
                                isExportable: cert.IsExportable,
                                provider: cert.Provider,
                                keyContainer: cert.KeyContainer,
                                isHardwareToken: !cert.IsExportable || cert.Provider.includes('CryptoID') || cert.Provider.includes('PKCS'),
                                detected: true
                            }));

                        resolve(formattedCerts);
                        
                    } catch (parseError) {
                        console.log('JSON parse error:', parseError.message);
                        resolve([]);
                    }
                });
                
            } catch (fileError) {
                console.log('Script file error:', fileError.message);
                resolve([]);
            }
        });
    }

    extractCNFromSubject(subject) {
        if (!subject) return 'Unknown Certificate';
        
        const patterns = [/CN=([^,]+)/i, /commonName=([^,]+)/i, /cn=([^,]+)/i];
        
        for (const pattern of patterns) {
            const match = subject.match(pattern);
            if (match) {
                return match[1].trim().replace(/"/g, '');
            }
        }
        
        const parts = subject.split(',')[0];
        return parts.includes('=') ? parts.split('=')[1].trim() : 'Certificate';
    }

    // Method 2: Export certificate with PIN/password for temporary use
    async exportCertificateTemporarily(thumbprint, password, outputPath) {
        return new Promise((resolve, reject) => {
            // Try to export even non-exportable certificates using certutil with PIN
            const command = `certutil -user -p "${password}" -exportPFX -privatekey my "${thumbprint}" "${outputPath}"`;
            
            exec(command, { timeout: 20000 }, (error, stdout, stderr) => {
                console.log('Temporary export stdout:', stdout);
                console.log('Temporary export stderr:', stderr);
                
                if (error) {
                    reject(new Error(`Certificate export failed: ${error.message}`));
                    return;
                }
                
                // Check if file was created and has content
                setTimeout(() => {
                    if (fs.existsSync(outputPath)) {
                        const stats = fs.statSync(outputPath);
                        if (stats.size > 0) {
                            resolve(outputPath);
                        } else {
                            reject(new Error('Empty certificate file - hardware token may not allow export'));
                        }
                    } else {
                        reject(new Error('Certificate export failed - file not created'));
                    }
                }, 2000);
            });
        });
    }
}

// Initialize Hardware Token Manager
const tokenManager = new HardwareTokenManager();

// Enhanced certificates endpoint
app.get('/certificates', async (req, res) => {
    try {
        console.log('📋 Certificate detection request received');
        const certificates = [];
        
        // Add static certificate option
        if (fs.existsSync('./certificate.pfx')) {
            certificates.push({
                type: 'static',
                name: '📄 Static Certificate (PFX File)',
                path: './certificate.pfx',
                id: 'static_cert',
                isExportable: true,
                isHardwareToken: false
            });
        }
        
        // Get certificates from Windows certificate store
        const windowsCerts = await tokenManager.getCertificatesFromWindowsStore();
        certificates.push(...windowsCerts);
        
        // Categorize certificates
        const softwareCerts = certificates.filter(cert => !cert.isHardwareToken);
        const hardwareTokenCerts = certificates.filter(cert => cert.isHardwareToken);
        
        res.json({ 
            certificates,
            softwareCertificates: softwareCerts,
            hardwareTokenCertificates: hardwareTokenCerts,
            availablePKCS11Libraries: tokenManager.pkcs11Libraries,
            message: `Found ${certificates.length} certificate(s). ${hardwareTokenCerts.length} on hardware token(s).`,
            debug: {
                totalCertificates: certificates.length,
                softwareCertificates: softwareCerts.length,
                hardwareTokenCertificates: hardwareTokenCerts.length,
                pkcs11LibrariesFound: tokenManager.pkcs11Libraries.length,
                platform: process.platform
            }
        });
    } catch (error) {
        console.error('❌ Certificate detection error:', error);
        res.status(500).json({ 
            error: 'Failed to get certificates: ' + error.message,
            certificates: []
        });
    }
});


app.post('/sign', upload.single('pdf'), async (req, res) => {
    let tempFiles = []; // Track all temp files for cleanup
    
    try {
        const { certificateId, certificateType, password, signingMethod = 'auto' } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }
        
        if (!password) {
            return res.status(400).json({ error: 'Certificate password/PIN is required' });
        }
        
        console.log(`🖊️ Starting signing process for: ${req.file.originalname}`);
        console.log(`📁 File info:`, {
            size: req.file.size,
            mimetype: req.file.mimetype,
            encoding: req.file.encoding,
            path: req.file.path
        });
        
        // STEP 1: COMPREHENSIVE FILE VALIDATION AND BUFFER CREATION
        let pdfBuffer;
        try {
            // Ensure file exists and is readable
            if (!fs.existsSync(req.file.path)) {
                throw new Error('Uploaded file does not exist');
            }
            
            const stats = fs.statSync(req.file.path);
            console.log(`📊 File stats: ${stats.size} bytes, modified: ${stats.mtime}`);
            
            if (stats.size === 0) {
                throw new Error('Uploaded file is empty');
            }
            
            if (stats.size > 50 * 1024 * 1024) { // 50MB limit
                throw new Error('File too large (max 50MB)');
            }
            
            // Read with explicit binary mode and create new buffer
            const rawData = fs.readFileSync(req.file.path);
            pdfBuffer = Buffer.from(rawData); // Force new buffer creation
            
            console.log(`📄 Buffer created: ${pdfBuffer.length} bytes`);
            console.log(`🔍 Buffer details:`, {
                isBuffer: Buffer.isBuffer(pdfBuffer),
                constructor: pdfBuffer.constructor.name,
                firstBytes: Array.from(pdfBuffer.slice(0, 10)).map(b => b.toString(16)).join(' ')
            });
            
            // Validate PDF structure
            const pdfSignature = pdfBuffer.slice(0, 5).toString('ascii');
            if (pdfSignature !== '%PDF-') {
                throw new Error(`Invalid PDF signature: "${pdfSignature}" (expected "%PDF-")`);
            }
            
            // Look for PDF version
            const versionMatch = pdfBuffer.slice(0, 20).toString('ascii').match(/%PDF-(\d\.\d)/);
            if (!versionMatch) {
                throw new Error('Could not determine PDF version');
            }
            
            console.log(`✅ Valid PDF detected: version ${versionMatch[1]}, size ${pdfBuffer.length} bytes`);
            
        } catch (bufferError) {
            console.error('❌ Buffer creation failed:', bufferError);
            throw new Error(`PDF processing failed: ${bufferError.message}`);
        }
        
        // STEP 2: CERTIFICATE HANDLING
        let signer;
        try {
            if (certificateType === 'static') {
                if (!fs.existsSync('./certificate.pfx')) {
                    throw new Error('Static certificate file ./certificate.pfx not found');
                }
                
                const certBuffer = fs.readFileSync('./certificate.pfx');
                if (certBuffer.length === 0) {
                    throw new Error('Certificate file is empty');
                }
                
                console.log(`🔐 Certificate loaded: ${certBuffer.length} bytes`);
                
                try {
                    signer = new P12Signer(certBuffer, { passphrase: password });
                    console.log('✅ Signer created successfully');
                } catch (signerError) {
                    throw new Error(`Invalid certificate password: ${signerError.message}`);
                }
                
            } else if (certificateType === 'windows_cert_store') {
                // Handle Windows certificate store
                const windowsCerts = await tokenManager.getCertificatesFromWindowsStore();
                const selectedCert = windowsCerts.find(cert => cert.id === certificateId);
                
                if (!selectedCert) {
                    throw new Error('Selected certificate not found in Windows store');
                }
                
                console.log(`🔐 Using Windows certificate: ${selectedCert.name}`);
                
                // Export certificate temporarily
                const tempCertPath = path.join(__dirname, `temp_cert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pfx`);
                tempFiles.push(tempCertPath);
                
                await tokenManager.exportCertificateTemporarily(selectedCert.thumbprint, password, tempCertPath);
                
                const exportedCertBuffer = fs.readFileSync(tempCertPath);
                if (exportedCertBuffer.length === 0) {
                    throw new Error('Exported certificate is empty');
                }
                
                signer = new P12Signer(exportedCertBuffer, { passphrase: password });
                console.log('✅ Windows certificate signer created');
                
            } else {
                throw new Error(`Invalid certificate type: ${certificateType}`);
            }
        } catch (certError) {
            console.error('❌ Certificate processing failed:', certError);
            throw new Error(`Certificate error: ${certError.message}`);
        }
        
        // STEP 3: PDF PLACEHOLDER ADDITION WITH ENHANCED ERROR HANDLING
        let pdfWithPlaceholder;
        try {
            console.log('📝 Adding signature placeholder...');
            
            // Create a fresh buffer copy to ensure no reference issues
            const freshPdfBuffer = Buffer.from(pdfBuffer);
            
            console.log(`🔍 Pre-placeholder buffer:`, {
                isBuffer: Buffer.isBuffer(freshPdfBuffer),
                length: freshPdfBuffer.length,
                type: typeof freshPdfBuffer,
                constructor: freshPdfBuffer.constructor.name
            });
            
            // Add placeholder with comprehensive options
            pdfWithPlaceholder = plainAddPlaceholder(freshPdfBuffer, {
                reason: 'Digital Signature',
                contactInfo: 'support@company.com',
                name: 'Document Signer',
                location: 'Digital Signing Service',
                signatureLength: 8192,
                subFilter: 'adbe.pkcs7.detached',
                widgetRect: [0, 0, 0, 0], // Invisible signature
            });
            
            console.log(`🔍 Post-placeholder buffer:`, {
                isBuffer: Buffer.isBuffer(pdfWithPlaceholder),
                length: pdfWithPlaceholder ? pdfWithPlaceholder.length : 'null',
                type: typeof pdfWithPlaceholder,
                constructor: pdfWithPlaceholder ? pdfWithPlaceholder.constructor.name : 'null'
            });
            
            if (!Buffer.isBuffer(pdfWithPlaceholder)) {
                throw new Error(`plainAddPlaceholder returned ${typeof pdfWithPlaceholder} instead of Buffer`);
            }
            
            if (pdfWithPlaceholder.length === 0) {
                throw new Error('Placeholder addition resulted in empty buffer');
            }
            
            if (pdfWithPlaceholder.length <= pdfBuffer.length) {
                console.log('⚠️ Warning: PDF size did not increase after placeholder addition');
            }
            
            console.log(`✅ Placeholder added successfully: ${pdfWithPlaceholder.length} bytes (delta: +${pdfWithPlaceholder.length - pdfBuffer.length})`);
            
        } catch (placeholderError) {
            console.error('❌ Placeholder addition failed:', placeholderError);
            console.error('Stack trace:', placeholderError.stack);
            
            // Additional debugging
            console.log('🔍 Debug info:', {
                originalBufferValid: Buffer.isBuffer(pdfBuffer),
                originalBufferLength: pdfBuffer ? pdfBuffer.length : 'null',
                pdfHeader: pdfBuffer ? pdfBuffer.slice(0, 10).toString('hex') : 'null'
            });
            
            throw new Error(`Failed to add signature placeholder: ${placeholderError.message}`);
        }
        
        // STEP 4: PDF SIGNING
        let signedPdfBuffer;
        try {
            console.log('🖊️ Signing PDF document...');
            
            signedPdfBuffer = await signpdf.sign(pdfWithPlaceholder, signer);
            
            if (!Buffer.isBuffer(signedPdfBuffer)) {
                throw new Error(`Signing returned ${typeof signedPdfBuffer} instead of Buffer`);
            }
            
            if (signedPdfBuffer.length === 0) {
                throw new Error('Signing resulted in empty buffer');
            }
            
            console.log(`✅ PDF signed successfully: ${signedPdfBuffer.length} bytes`);
            
        } catch (signingError) {
            console.error('❌ PDF signing failed:', signingError);
            throw new Error(`PDF signing failed: ${signingError.message}`);
        }
        
        // STEP 5: SEND RESPONSE
        console.log(`🎉 Signing completed successfully!`);
        
        // Clean up uploaded file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        // Send signed PDF
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': signedPdfBuffer.length.toString(),
            'Content-Disposition': 'attachment; filename="signed.pdf"',
            'Cache-Control': 'no-cache'
        });
        
        res.send(signedPdfBuffer);
        
    } catch (error) {
        console.error('❌ Complete signing process failed:', error);
        console.error('Stack trace:', error.stack);
        
        // Comprehensive cleanup
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
                console.log('🧹 Cleaned uploaded file');
            } catch (cleanupError) {
                console.log('⚠️ Could not clean uploaded file:', cleanupError.message);
            }
        }
        
        // Clean up temp files
        tempFiles.forEach(tempFile => {
            if (fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                    console.log(`🧹 Cleaned temp file: ${tempFile}`);
                } catch (cleanupError) {
                    console.log(`⚠️ Could not clean temp file ${tempFile}:`, cleanupError.message);
                }
            }
        });
        
        // Clean up any remaining temp files
        try {
            const allTempFiles = fs.readdirSync(__dirname).filter(file => 
                file.startsWith('temp_cert_') || 
                file.startsWith('temp_script_') ||
                file.startsWith('temp_pdf_')
            );
            
            allTempFiles.forEach(file => {
                try {
                    fs.unlinkSync(path.join(__dirname, file));
                    console.log(`🧹 Cleaned orphaned temp file: ${file}`);
                } catch (e) {
                    // Ignore cleanup errors for orphaned files
                }
            });
        } catch (dirError) {
            // Ignore directory read errors
        }
        
        res.status(500).json({ 
            error: error.message,
            details: 'PDF signing process failed - check server logs for details',
            timestamp: new Date().toISOString(),
            requestId: `req_${Date.now()}`
        });
    }
});



// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        staticCertAvailable: fs.existsSync('./certificate.pfx'),
        pkcs11LibrariesFound: tokenManager.pkcs11Libraries.length,
        supportedMethods: ['export', 'auto']
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log(`📋 Platform: ${process.platform}`);
    console.log(`🔧 Mode: Enhanced Hardware Token Support`);
    console.log(`📄 Static Certificate: ${fs.existsSync('./certificate.pfx') ? '✅ Available' : '❌ Missing'}`);
    console.log(`🔒 PKCS11 Libraries Found: ${tokenManager.pkcs11Libraries.length}`);
    console.log(`⚙️  Supported Signing Methods: export, auto`);
});
