const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

class USBTokenManager {
    constructor() {
        this.mockTokens = [
            {
                type: 'mock_usb',
                name: 'Simulated USB Token (eToken Pro)',
                id: 'mock_token_1',
                serial: 'SIM123456'
            },
            {
                type: 'mock_smartcard',
                name: 'Simulated Smart Card Reader',
                id: 'mock_reader_1',
                serial: 'SCR789012'
            }
        ];
        console.log('🔧 USB Token Manager initialized (Simulation Mode)');
    }

    // Simulate USB token detection
    async detectTokens() {
        // Simulate detection delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // On Windows, try to detect actual smart card readers
        if (process.platform === 'win32') {
            try {
                const realReaders = await this.detectWindowsReaders();
                if (realReaders.length > 0) {
                    return [...this.mockTokens, ...realReaders];
                }
            } catch (error) {
                console.log('Windows reader detection failed:', error.message);
            }
        }
        
        return this.mockTokens;
    }

    // Detect Windows smart card readers using system commands
    async detectWindowsReaders() {
        return new Promise((resolve) => {
            exec('powershell "Get-PnpDevice -Class SmartCardReader"', (error, stdout) => {
                const readers = [];
                if (!error && stdout) {
                    const lines = stdout.split('\n');
                    lines.forEach((line, index) => {
                        if (line.includes('OK') && line.includes('Smart')) {
                            readers.push({
                                type: 'windows_reader',
                                name: `Windows Smart Card Reader ${index + 1}`,
                                id: `win_reader_${index}`,
                                detected: true
                            });
                        }
                    });
                }
                resolve(readers);
            });
        });
    }

    // Simulate certificate reading from USB token
    async readCertificateFromToken(tokenInfo, password) {
        // Simulate hardware access delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`📖 Reading certificate from: ${tokenInfo.name}`);
        console.log(`🔐 Using password: ${'*'.repeat(password.length)}`);
        
        // Validate password (basic simulation)
        if (password.length < 4) {
            throw new Error('Password too short');
        }
        
        // Use static certificate as fallback for all token types
        const certPath = './certificate.pfx';
        if (fs.existsSync(certPath)) {
            console.log('✅ Certificate read successfully from token simulation');
            return fs.readFileSync(certPath);
        }
        
        // Generate a mock certificate buffer if no static cert exists
        const mockCert = Buffer.from(`MOCK_CERTIFICATE_${tokenInfo.id}_${Date.now()}`);
        console.log('⚠️ Using mock certificate (no static certificate found)');
        return mockCert;
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
