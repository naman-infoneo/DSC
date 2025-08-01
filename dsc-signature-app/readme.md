
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

```
