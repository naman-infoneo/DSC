const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { signPdf } = require('@signpdf/signpdf');
const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');
const cors = require('cors');
const WindowsCertificateManager = require('./windows-certificate-manager');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use(express.json());

const certManager = new WindowsCertificateManager();

// API to get certificates from Windows Certificate Store
app.get('/windows-certificates', async (req, res) => {
  try {
    const certificates = await certManager.getCertificatesFromStore();
    const usbCertificates = await certManager.getUSBTokenCertificates();

    console.log('sdfs' ,certificates )
    
    res.json({
      success: true,
      certificates: {
        all: certificates,
        usbToken: usbCertificates
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sign PDF using Windows Certificate Store
app.post('/sign-windows-cert', upload.single('pdf'), async (req, res) => {
  let tempCertPath = null;
  
  try {
    const { thumbprint, password = '' } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    if (!thumbprint) {
      return res.status(400).json({ error: 'Certificate thumbprint required' });
    }

    // Read PDF
    const pdfBuffer = fs.readFileSync(req.file.path);
    
    // Export certificate from Windows store
    tempCertPath = await certManager.exportCertificate(thumbprint, password);
    const p12Buffer = fs.readFileSync(tempCertPath);
    
    // Add placeholder and sign
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer,
      reason: 'Signed with Windows Certificate Store',
      location: 'Windows Certificate Store',
    });
    
    const signedPdf = signPdf(pdfWithPlaceholder, p12Buffer, {
      passphrase: password
    });

    // Cleanup
    fs.unlinkSync(req.file.path);
    if (tempCertPath && fs.existsSync(tempCertPath)) {
      fs.unlinkSync(tempCertPath);
    }

    res.type('application/pdf');
    res.send(signedPdf);
  } catch (error) {
    console.error('Signing error:', error);
    
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (tempCertPath && fs.existsSync(tempCertPath)) {
      fs.unlinkSync(tempCertPath);
    }
    
    res.status(500).json({ error: 'Signing error: ' + error.message });
  }
});

// Cleanup on exit
process.on('exit', () => {
  certManager.cleanup();
});

process.on('SIGINT', () => {
  certManager.cleanup();
  process.exit(0);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Windows Certificate Store server running on port ${PORT}`);
});