const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const winston = require('winston');

const execAsync = promisify(exec);

class WindowsCertificateManager {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'cert-manager.log' })
      ],
    });
  }

  // Use PowerShell to access Windows Certificate Store
  async getCertificatesFromStore() {
    try {
      const powershellScript = `
        Get-ChildItem -Path Cert:\\CurrentUser\\My | Where-Object {
          $_.HasPrivateKey -eq $true -and 
          $_.NotAfter -gt (Get-Date)
        } | Select-Object Subject, Issuer, Thumbprint, FriendlyName, NotBefore, NotAfter | ConvertTo-Json
      `;

      const { stdout } = await execAsync(`powershell -Command "${powershellScript}"`);
      
      if (stdout.trim()) {
        const certificates = JSON.parse(stdout);
        return Array.isArray(certificates) ? certificates : [certificates];
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Error getting certificates: ${error.message}`);
      throw error;
    }
  }

  // Get certificates from USB tokens via certlm.msc
  async getUSBTokenCertificates() {
    try {
      // This PowerShell script looks for certificates that might be on smart cards/tokens
      const powershellScript = `
        Get-ChildItem -Path Cert:\\CurrentUser\\My | Where-Object {
          $_.HasPrivateKey -eq $true -and 
          $_.NotAfter -gt (Get-Date) -and
          ($_.PSParentPath -like "*Smart Card*" -or $_.FriendlyName -like "*Token*" -or $_.FriendlyName -like "*eToken*")
        } | Select-Object Subject, Issuer, Thumbprint, FriendlyName, NotBefore, NotAfter, PSParentPath | ConvertTo-Json
      `;

      const { stdout } = await execAsync(`powershell -Command "${powershellScript}"`);
      
      if (stdout.trim()) {
        const certificates = JSON.parse(stdout);
        return Array.isArray(certificates) ? certificates : [certificates];
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Error getting USB token certificates: ${error.message}`);
      return [];
    }
  }

  // Export certificate for signing
  async exportCertificate(thumbprint, password = '') {
    try {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }

      const certPath = path.join(tempDir, `cert_${thumbprint}.pfx`);
      
      const powershellScript = `
        $cert = Get-ChildItem -Path Cert:\\CurrentUser\\My\\${thumbprint}
        if ($cert) {
          $pfxBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, "${password}")
          [System.IO.File]::WriteAllBytes("${certPath.replace(/\\/g, '\\\\')}", $pfxBytes)
          Write-Output "Success"
        } else {
          Write-Output "Certificate not found"
        }
      `;

      const { stdout } = await execAsync(`powershell -Command "${powershellScript}"`);
      
      if (stdout.trim() === 'Success' && fs.existsSync(certPath)) {
        return certPath;
      }
      
      throw new Error('Certificate export failed');
    } catch (error) {
      this.logger.error(`Error exporting certificate: ${error.message}`);
      throw error;
    }
  }

  // Clean up temporary files
  cleanup() {
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          this.logger.warn(`Could not delete ${filePath}: ${error.message}`);
        }
      });
    }
  }
}

module.exports = WindowsCertificateManager;