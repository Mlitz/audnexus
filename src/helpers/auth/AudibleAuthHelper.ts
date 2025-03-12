import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import jsrsasign from 'jsrsasign'

interface AudibleAuthCredentials {
  email: string
  password: string
  country: string
}

interface AudibleAuthResponse {
  success: boolean
  adpToken?: string
  privateKey?: string
  message?: string
}

interface AudibleTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

class AudibleAuthHelper {
  private readonly USER_AGENT = 'Audible/3.92.0 (iPhone; iOS 15.0; Scale/3.00)'
  private readonly CLIENT_ID = 'YTJtUmZ5cGJvWWhkNHBrYmhuWVpZ'
  private readonly BASE_URL = 'https://api.audible.com'
  private registeredDevices: Map<string, string> = new Map()
  
  /**
   * Initialize a new Audible authentication session
   * @param audibleCredentials Email, password, and country code for Audible
   */
  async authenticate(audibleCredentials: AudibleAuthCredentials): Promise<AudibleAuthResponse> {
    try {
      // Step 1: Authenticate with Audible and get access token
      const tokens = await this.getAudibleTokens(audibleCredentials)
      if (!tokens) {
        return { success: false, message: 'Failed to authenticate with Audible' }
      }
      
      // Step 2: Register a new device and generate private key
      const privateKey = this.generatePrivateKey()
      
      // Step 3: Register the device with Audible
      const deviceSerialNumber = this.generateDeviceSerialNumber()
      const adpToken = await this.registerDevice(
        tokens.access_token, 
        privateKey, 
        deviceSerialNumber,
        audibleCredentials.country
      )
      
      if (!adpToken) {
        return { success: false, message: 'Failed to register device with Audible' }
      }
      
      return {
        success: true,
        adpToken,
        privateKey: this.formatPrivateKeyForExport(privateKey)
      }
    } catch (error) {
      console.error('Authentication error:', error)
      return { 
        success: false, 
        message: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
  
  /**
   * Get Audible access tokens using login credentials
   */
  private async getAudibleTokens(credentials: AudibleAuthCredentials): Promise<AudibleTokens | null> {
    try {
      const params = new URLSearchParams({
        'auth_country': credentials.country,
        'client_id': this.CLIENT_ID,
        'grant_type': 'password',
        'username': credentials.email,
        'password': credentials.password,
        'scope': 'all:device'
      })
      
      const response = await axios.post(
        `${this.BASE_URL}/auth/token`, 
        params.toString(),
        {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      )
      
      if (response.status === 200 && response.data) {
        return response.data as AudibleTokens
      }
      
      return null
    } catch (error) {
      console.error('Error getting Audible tokens:', error)
      throw new Error('Failed to authenticate with Audible')
    }
  }
  
  /**
   * Generate a new RSA private key
   */
  private generatePrivateKey(): string {
    const key = new jsrsasign.KJUR.crypto.RSAKey()
    key.generate(2048, '10001') // Generate 2048-bit RSA key
    return jsrsasign.KEYUTIL.getPEM(key, true) // Get PEM format with private key
  }

  /**
   * Format private key for environment variable export
   */
  private formatPrivateKeyForExport(privateKey: string): string {
    return privateKey.replace(/\n/g, '\\n')
  }
  
  /**
   * Generate a random device serial number
   */
  private generateDeviceSerialNumber(): string {
    return `A2CZJZGLK2JJVM-${crypto.randomBytes(10).toString('hex').toUpperCase()}`
  }
  
  /**
   * Register a device with Audible and get an ADP token
   */
  private async registerDevice(
    accessToken: string, 
    privateKey: string, 
    serialNumber: string,
    countryCode: string
  ): Promise<string | null> {
    try {
      // Generate device public key from private key
      const privKeyObj = jsrsasign.KEYUTIL.getKey(privateKey)
      if (!(privKeyObj instanceof jsrsasign.RSAKey)) {
        throw new Error('Failed to generate valid RSA key')
      }
      
      const pubKey = jsrsasign.KEYUTIL.getPEM(privKeyObj)
      
      // Register device with Audible
      const deviceData = {
        'app_name': 'Audible',
        'app_version': '3.92.0',
        'device_model': 'iPhone',
        'device_serial': serialNumber,
        'os_name': 'iOS',
        'os_version': '15.0',
        'device_name': `iPhone (audnexus-${new Date().toISOString().slice(0, 10)})`,
        'software_version': '3.92.0',
        'device_type': 'A2CZJZGLK2JJVM',
        'public_key': pubKey
      }
      
      const response = await axios.post(
        `${this.BASE_URL}/device/registerDevice`,
        deviceData,
        {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (response.status === 200 && response.data && response.data.adp_token) {
        // Store this device registration
        this.registeredDevices.set(serialNumber, response.data.adp_token)
        return response.data.adp_token
      }
      
      return null
    } catch (error) {
      console.error('Error registering device:', error)
      throw new Error('Failed to register device with Audible')
    }
  }
  
  /**
   * Generate configuration for the .env file or environment variables
   */
  generateConfigString(adpToken: string, privateKey: string): string {
    return `# Audible Authentication Configuration
# Generated by audnexus on ${new Date().toISOString()}
# Add these to your environment variables or .env file

ADP_TOKEN=${adpToken}
PRIVATE_KEY=${privateKey}
`
  }
  
  /**
   * Save configuration to a file
   */
  async saveConfigToFile(adpToken: string, privateKey: string, filePath: string): Promise<boolean> {
    try {
      const config = this.generateConfigString(adpToken, privateKey)
      await fs.promises.writeFile(filePath, config, 'utf8')
      return true
    } catch (error) {
      console.error('Error saving config to file:', error)
      return false
    }
  }
}

// Export router to register with Fastify
export default async function registerAudibleAuthRoutes(fastify: FastifyInstance) {
  const authHelper = new AudibleAuthHelper()
  
  // Route to serve the authentication UI
  fastify.get('/auth/audible', async (request: FastifyRequest, reply: FastifyReply) => {
    // Simple HTML form for authentication
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Audnexus - Audible Authentication</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 {
            color: #333;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            margin-bottom: 5px;
          }
          input[type="text"],
          input[type="password"],
          select {
            width: 100%;
            padding: 8px;
            box-sizing: border-box;
          }
          button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 15px;
            border: none;
            cursor: pointer;
          }
          .note {
            background-color: #ffffcc;
            padding: 10px;
            border-left: 4px solid #ffeb3b;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <h1>Audible Authentication</h1>
        <p>Generate ADP_TOKEN and PRIVATE_KEY for audnexus chapters functionality</p>
        
        <form id="authForm">
          <div class="form-group">
            <label for="email">Audible Email:</label>
            <input type="text" id="email" name="email" required>
          </div>
          
          <div class="form-group">
            <label for="password">Audible Password:</label>
            <input type="password" id="password" name="password" required>
          </div>
          
          <div class="form-group">
            <label for="country">Audible Marketplace:</label>
            <select id="country" name="country">
              <option value="us">United States (us)</option>
              <option value="ca">Canada (ca)</option>
              <option value="uk">United Kingdom (uk)</option>
              <option value="au">Australia (au)</option>
              <option value="fr">France (fr)</option>
              <option value="de">Germany (de)</option>
              <option value="jp">Japan (jp)</option>
              <option value="it">Italy (it)</option>
              <option value="in">India (in)</option>
              <option value="es">Spain (es)</option>
            </select>
          </div>
          
          <button type="submit">Generate Keys</button>
        </form>
        
        <div id="result" style="display: none; margin-top: 20px;">
          <h2>Authentication Result</h2>
          <div id="resultContent"></div>
          <button id="downloadBtn" style="margin-top: 10px;">Download Configuration</button>
        </div>
        
        <div class="note">
          <strong>Note:</strong> Your credentials are used only to authenticate with Audible and generate device keys.
          They are not stored on the server after processing.
        </div>
        
        <script>
          document.getElementById('authForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const country = document.getElementById('country').value;
            
            try {
              const response = await fetch('/auth/audible/generate', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, country })
              });
              
              const result = await response.json();
              
              const resultDiv = document.getElementById('result');
              const resultContent = document.getElementById('resultContent');
              
              if (result.success) {
                resultContent.innerHTML = \`
                  <p style="color: green;">Successfully generated keys!</p>
                  <h3>ADP_TOKEN:</h3>
                  <pre style="background: #f5f5f5; padding: 10px; overflow-x: auto;">\${result.adpToken}</pre>
                  <h3>PRIVATE_KEY:</h3>
                  <pre style="background: #f5f5f5; padding: 10px; overflow-x: auto;">\${result.privateKey}</pre>
                  <p>Add these values to your environment variables or .env file.</p>
                \`;
                
                // Setup download button
                const downloadBtn = document.getElementById('downloadBtn');
                downloadBtn.onclick = () => {
                  const config = \`# Audible Authentication Configuration
# Generated by audnexus on \${new Date().toISOString()}
# Add these to your environment variables or .env file

ADP_TOKEN=\${result.adpToken}
PRIVATE_KEY=\${result.privateKey}
\`;
                  
                  const blob = new Blob([config], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'audnexus-audible-auth.env';
                  a.click();
                  URL.revokeObjectURL(url);
                };
              } else {
                resultContent.innerHTML = \`
                  <p style="color: red;">Authentication failed!</p>
                  <p>\${result.message || 'Unknown error occurred.'}</p>
                \`;
              }
              
              resultDiv.style.display = 'block';
            } catch (error) {
              console.error('Error:', error);
              alert('An error occurred while authenticating. Please try again.');
            }
          });
        </script>
      </body>
      </html>
    `
    
    return reply.type('text/html').send(html)
  })
  
  // API endpoint to generate authentication tokens
  fastify.post('/auth/audible/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as AudibleAuthCredentials
    
    if (!body.email || !body.password || !body.country) {
      return reply.code(400).send({
        success: false,
        message: 'Email, password, and country are required'
      })
    }
    
    try {
      const result = await authHelper.authenticate(body)
      return reply.send(result)
    } catch (error) {
      console.error('Authentication error:', error)
      return reply.code(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Authentication failed'
      })
    }
  })
}
