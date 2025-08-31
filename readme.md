
# Digital Signature Certificate (DSC) PDF Signing Application

This project demonstrates the implementation of Digital Signature Certificate (DSC) based PDF signing using Node.js and React. It provides both production-ready Class 3 DSC integration and local testing capabilities with self-signed certificates.

## What is Class 3 Soft Token Based DSC?

A **Class 3 Digital Signature Certificate (DSC)** is the highest level of digital certificate that provides maximum security for digital transactions. Here's what makes it special:

### Key Features:
- **Highest Level of Assurance**: Class 3 certificates require in-person identity verification or video-based verification
- **Soft Token Technology**: The certificate is stored on a USB token (hardware device) that contains the private key securely
- **Public Key Infrastructure (PKI)**: Uses asymmetric encryption with public-private key pairs
- **Legal Validity**: Legally recognized under the Information Technology Act, 2000 in India
- **Tamper Proof**: The private key never leaves the USB token, ensuring maximum security

### How Class 3 DSC Works:
1. **Key Generation**: A pair of cryptographic keys (public and private) are generated
2. **Certificate Issuance**: A licensed Certifying Authority (CA) issues the certificate after thorough identity verification
3. **Secure Storage**: The private key is stored in a tamper-proof USB token
4. **Digital Signing**: Documents are signed using the private key, creating a unique digital signature

## How DSC Signs a PDF Document

The PDF signing process using DSC involves several cryptographic steps:

### 1. Document Hashing
- The PDF content is processed through a hash algorithm (typically SHA-256)
- This creates a unique fingerprint of the document

### 2. Digital Signature Creation
- The hash is encrypted using the private key from the DSC token
- This encrypted hash becomes the digital signature

### 3. Certificate Embedding
- The digital signature and the public certificate are embedded into the PDF
- Additional metadata like signing time, location, and reason are included

### 4. Verification Process
- Anyone can verify the signature using the public key
- The verification confirms both the identity of the signer and document integrity

```javascript
// Example signing process (simplified)
const pdfBuffer = fs.readFileSync('document.pdf');
const hashedPdf = crypto.createHash('sha256').update(pdfBuffer).digest();
const signature = crypto.sign('RSA-SHA256', hashedPdf, privateKey);
// Embed signature and certificate into PDF
```

## Benefits of DSC for Document Authentication

### For Individuals:
1. **Legal Validity**: Digitally signed documents have the same legal standing as physically signed documents
2. **Non-Repudiation**: Signers cannot deny having signed the document
3. **Document Integrity**: Any tampering with the document after signing is detectable
4. **Time Stamping**: Provides proof of when the document was signed
5. **Cost Effective**: Eliminates the need for physical presence and paper-based processes
6. **Faster Processing**: Instant signing and verification capabilities
7. **Environmentally Friendly**: Reduces paper usage and physical document handling

### For Organizations:
1. **Workflow Automation**: Streamlines document approval processes
2. **Audit Trail**: Complete tracking of document lifecycle and signatures
3. **Compliance**: Meets regulatory requirements for digital transactions
4. **Security**: Enhanced security compared to traditional paper-based signatures
5. **Storage Efficiency**: Digital documents are easier to store and retrieve

### Authentication Benefits:
- **Identity Verification**: Confirms the actual identity of the signer
- **Document Authenticity**: Proves the document hasn't been altered
- **Timestamp Accuracy**: Provides reliable proof of signing time
- **Certificate Chain Validation**: Ensures the certificate is issued by a trusted CA

## Implementation Notes

This application was developed after conducting research on Digital Signature Certificate technology and its practical implementation in PDF signing workflows. The research covered:

- PKI (Public Key Infrastructure) fundamentals
- PDF signing standards and best practices
- Integration with hardware tokens and certificate stores
- Legal frameworks governing digital signatures in India
- Security considerations for production deployments

The implementation demonstrates both development-friendly approaches (using self-signed certificates) and production-ready integration with actual Class 3 DSC tokens.

## Obtaining a Class 3 DSC (Production Use)
- Where to get a DSC: Class 3 DSCs in India are issued by licensed Certifying Authorities (CA) such as eMudhra, Capricorn, or others. See the Controller of Certifying Authorities (CCA) website for a full list. You apply online, submit KYC, and after mobile/video verification your DSC is issued.

- What you receive: A USB token containing your DSC (private key securely stored).

- Usage: Production DSCs can be plugged into your server/PC to sign documents.

## Using Dummy (Self-Signed) Certificates for Local Testing

```bash
# Generate a private key
openssl genrsa -out private.key 2048

# Create a certificate signing request (CSR)
openssl req -new -key private.key -out cert.csr -subj "//CN=Dummy Test User"

# Generate a self-signed x509 certificate
openssl x509 -req -days 365 -in cert.csr -signkey private.key -out certificate.pem

# Export to PKCS12 (.pfx) for use in most PDF signing libraries
openssl pkcs12 -export -out certificate.pfx -inkey private.key -in certificate.pem

```


## File Structure Overview

```
dsc-signature-app/
├── backend/
│   ├── package.json
│   ├── sign.js                   # Node.js code for PDF signing
│   └── certificate.pfx           # Your self-signed (dummy) certificate
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js                # React UI
│   │   └── components/           # Signature modal, etc.
├── pdfs/
│   └── sample.pdf                # PDF files to be signed
└── README.md
```

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn package manager
- OpenSSL (for generating test certificates)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/naman-infoneo/DSC.git
cd DSC
```

2. **Install backend dependencies**
```bash
cd dsc-signature-app/backend
npm install
```

3. **Install frontend dependencies**
```bash
cd ../frontend
npm install
```

### Running the Application

1. **Start the backend server**
```bash
cd dsc-signature-app/backend
npm start
# Server will run on http://localhost:3001
```

2. **Start the frontend application**
```bash
cd dsc-signature-app/frontend
npm run dev
# Application will open in browser at http://localhost:5173
```

3. **Upload and sign a PDF**
- Navigate to the web interface
- Select a PDF file to sign
- Click "Sign PDF" to generate a digitally signed document
- The signed PDF will be automatically downloaded

## Technical Architecture

The application uses the following technology stack:

- **Backend**: Node.js with Express.js framework
- **Frontend**: React.js with Vite build tool
- **PDF Signing**: node-signpdf library for PDF digital signatures
- **Certificate Handling**: PKCS#12 format for certificate storage
- **File Upload**: Multer middleware for handling file uploads

## Security Considerations

- Private keys are never transmitted over the network
- Certificate validation ensures authenticity
- Secure file handling prevents unauthorized access
- Production deployment requires proper HTTPS configuration

## Related Technologies

- **X.509 Certificates**: Standard format for digital certificates
- **PKCS#12**: Standard for storing certificates and private keys
- **PDF Advanced Electronic Signatures (PAdES)**: European standard for PDF signatures
- **RFC 3161**: Time-Stamping Protocol for added security
