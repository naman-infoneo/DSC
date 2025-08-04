const express = require('express');
const multer = require('multer');
const fs = require('fs');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());

// Function to fix PDF buffer by ensuring proper EOF
function fixPdfBuffer(buffer) {
  // Convert buffer to string to check the end
  const pdfString = buffer.toString('binary');
  
  // Check if PDF ends with %%EOF
  if (!pdfString.trimEnd().endsWith('%%EOF')) {
    // If not, we need to find the last %%EOF and trim everything after it
    const lastEofIndex = pdfString.lastIndexOf('%%EOF');
    if (lastEofIndex !== -1) {
      // Create new buffer ending right after %%EOF
      const fixedString = pdfString.substring(0, lastEofIndex + 5);
      return Buffer.from(fixedString, 'binary');
    }
  }
  
  // Remove any trailing whitespace/newlines after %%EOF
  const trimmedString = pdfString.replace(/%%EOF\s*$/g, '%%EOF');
  return Buffer.from(trimmedString, 'binary');
}

// Alternative function using a more robust approach
function ensurePdfEof(buffer) {
  // Find the last occurrence of %%EOF
  const eofMarker = Buffer.from('%%EOF');
  let lastEofIndex = -1;
  
  for (let i = buffer.length - eofMarker.length; i >= 0; i--) {
    if (buffer.subarray(i, i + eofMarker.length).equals(eofMarker)) {
      lastEofIndex = i;
      break;
    }
  }
  
  if (lastEofIndex === -1) {
    throw new Error('Invalid PDF: No %%EOF marker found');
  }
  
  // Return buffer up to and including %%EOF (5 bytes after the start of %%EOF)
  return buffer.subarray(0, lastEofIndex + 5);
}

app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No PDF file uploaded');
    }

    console.log('Processing file:', req.file.originalname);
    
    let pdfBuffer = fs.readFileSync(req.file.path);
    console.log('Original PDF size:', pdfBuffer.length);
    
    // Fix the PDF buffer to ensure proper EOF
    try {
      pdfBuffer = ensurePdfEof(pdfBuffer);
      console.log('Fixed PDF size:', pdfBuffer.length);
    } catch (fixError) {
      console.error('PDF fix error:', fixError);
      // Try the alternative fix method
      pdfBuffer = fixPdfBuffer(pdfBuffer);
      console.log('Alternative fix applied, PDF size:', pdfBuffer.length);
    }
    
    // Add placeholder for signature
    const placeholderPdf = plainAddPlaceholder({ 
      pdfBuffer,
      reason: 'Digitally signed',
      location: 'Digital Signature',
      signatureLength: 1612
    });
    
    // Read certificate
    const p12Buffer = fs.readFileSync('./certificate.pfx');
    
    // Sign the PDF
    const signedPdf = signer.sign(placeholderPdf, p12Buffer, { 
      passphrase: '123456',
      asn1StrictParsing: false
    });
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    // Send signed PDF
    res.type('application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="signed.pdf"');
    res.send(signedPdf);
    
    console.log('PDF signed successfully');
    
  } catch (err) {
    console.error('Signing error:', err);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Signing error', 
      message: err.message,
      type: err.type || 'unknown'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log('Make sure certificate.pfx is in the root directory');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});