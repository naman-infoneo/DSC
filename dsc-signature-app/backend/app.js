const express = require('express');
const multer = require('multer');
const fs = require('fs');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());

app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const placeholderPdf = plainAddPlaceholder(
      {
        pdfBuffer, 
        reason: 'Document approval',
        location: 'India',
        name: 'Your Name',
        contactInfo: 'support@yourcompany.com'
      });
    const p12Buffer = fs.readFileSync('./certificate.pfx');
    const signedPdf = signer.sign(placeholderPdf, p12Buffer, { passphrase: '123456' });
    fs.unlinkSync(req.file.path);
    res.type('application/pdf');
    res.send(signedPdf);
  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).send('Signing error: ' + err.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
