const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use(express.json());

// Generate RSA key pair for asymmetric encryption (run once)
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  fs.writeFileSync('publicKey.pem', publicKey);
  fs.writeFileSync('privateKey.pem', privateKey);
}

// Generate keys if they don't exist
if (!fs.existsSync('publicKey.pem') || !fs.existsSync('privateKey.pem')) {
  generateKeyPair();
}

// Encrypt file path (for logging purposes)
function encryptFilePath(filePath) {
  const publicKey = fs.readFileSync('publicKey.pem', 'utf8');
  const encrypted = crypto.publicEncrypt(publicKey, Buffer.from(filePath));
  return encrypted.toString('base64');
}

// Decrypt file path
function decryptFilePath(encryptedPath) {
  const privateKey = fs.readFileSync('privateKey.pem', 'utf8');
  const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(encryptedPath, 'base64'));
  return decrypted.toString('utf8');
}

// Generate hash of PDF
function generatePdfHash(pdfBuffer) {
  return crypto.createHash('sha256').update(pdfBuffer).digest('hex');
}

// Store signing information
function storeSigningInfo(hash, signerInfo, originalFileName, encryptedOriginalName) {
  const timestamp = new Date().toISOString();
  let decryptedOriginalName = originalFileName;
  
  // Try to decrypt the original filename if provided
  if (encryptedOriginalName) {
    try {
      decryptedOriginalName = decryptFilePath(encryptedOriginalName);
    } catch (error) {
      console.error('Could not decrypt original filename:', error);
    }
  }
  
  const logEntry = {
    timestamp,
    originalFileName: decryptedOriginalName,
    pdfHash: hash,
    signer: signerInfo,
    signatureId: crypto.randomUUID()
  };
  
  const logFileName = `signing_log_${Date.now()}.txt`;
  const logContent = `
=== PDF SIGNATURE LOG ===
Timestamp: ${logEntry.timestamp}
Original File: ${logEntry.originalFileName}
PDF Hash (SHA256): ${logEntry.pdfHash}
Signer Information: ${logEntry.signer}
Signature ID: ${logEntry.signatureId}
========================
`;
  
  fs.writeFileSync(logFileName, logContent);
  
  // Also append to master log
  const masterLogContent = `${timestamp} | ${logEntry.signatureId} | ${logEntry.originalFileName} | ${logEntry.pdfHash} | ${logEntry.signer}\n`;
  fs.appendFileSync('master_signing_log.txt', masterLogContent);
  
  return logFileName;
}

// Get public key endpoint
app.get('/public-key', (req, res) => {
  const publicKey = fs.readFileSync('publicKey.pem', 'utf8');
  res.json({ publicKey });
});

app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    const { password, signerName, signerEmail, encryptedPath } = req.body;
    
    if (!password) {
      return res.status(400).send('Password is required');
    }
    
    if (!signerName || !signerEmail) {
      return res.status(400).send('Signer name and email are required');
    }

    // ✅ ALWAYS use the actual uploaded file path
    const actualFilePath = req.file.path;
    
    console.log('Processing file:', req.file.originalname);
    console.log('Actual file path:', actualFilePath);
    
    // Check if file exists
    if (!fs.existsSync(actualFilePath)) {
      throw new Error(`Uploaded file not found: ${actualFilePath}`);
    }
    
    const pdfBuffer = fs.readFileSync(actualFilePath);
    
    // Generate hash before signing
    const originalHash = generatePdfHash(pdfBuffer);
    
    const placeholderPdf = plainAddPlaceholder({ pdfBuffer });
    const p12Buffer = fs.readFileSync('./certificate.pfx');
    
    // Use dynamic password from frontend
    const signedPdf = signer.sign(placeholderPdf, p12Buffer, { passphrase: password });
    
    // Generate hash after signing
    const signedHash = generatePdfHash(signedPdf);
    
    // Store signing information (use encrypted path for logging if provided)
    const signerInfo = `${signerName} (${signerEmail})`;
    const logFileName = storeSigningInfo(signedHash, signerInfo, req.file.originalname, encryptedPath);
    
    // Clean up uploaded file
    fs.unlinkSync(actualFilePath);
    
    console.log(`PDF signed successfully. Log saved to: ${logFileName}`);
    console.log(`Original PDF Hash: ${originalHash}`);
    console.log(`Signed PDF Hash: ${signedHash}`);
    
    res.type('application/pdf');
    res.set('X-Signature-Log', logFileName);
    res.set('X-PDF-Hash', signedHash);
    res.send(signedPdf);
    
  } catch (err) {
    console.error('Signing error:', err);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).send('Signing error: ' + err.message);
  }
});

// Get signing logs endpoint
app.get('/logs', (req, res) => {
  try {
    if (fs.existsSync('master_signing_log.txt')) {
      const logs = fs.readFileSync('master_signing_log.txt', 'utf8');
      res.send(logs);
    } else {
      res.send('No signing logs found.');
    }
  } catch (error) {
    res.status(500).send('Error reading logs: ' + error.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
