import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as jsrsasign from 'jsrsasign'

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

export class AudibleAuthHelper {
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
      console.log('Starting authentication process with Audible...');
      
      // Step 1: Authenticate with Audible and get access token
      const tokens = await this.getAudibleTokens(audibleCredentials)
      if (!tokens) {
        console.error('Failed to get tokens from Audible');
        return { success: false, message: 'Failed to authenticate with Audible' }
      }
      
      console.log('Successfully obtained access token');
      
      // Step 2: Register a new device and generate private key
      const privateKey = this.generatePrivateKey()
      console.log('Generated private key');
      
      // Step 3: Register the device with Audible
      const deviceSerialNumber = this.generateDeviceSerialNumber()
      console.log('Generated device serial number:', deviceSerialNumber);
      
      const adpToken = await this.registerDevice(
        tokens.access_token, 
        privateKey, 
        deviceSerialNumber,
        audibleCredentials.country
      )
      
      if (!adpToken) {
        console.error('Failed to register device with Audible');
        return { success: false, message: 'Failed to register device with Audible' }
      }
      
      console.log('Successfully registered device with Audible');
      
      return {
        success: true,
        adpToken,
        privateKey: this.formatPrivateKeyForExport(privateKey)
      }
    } catch (error) {
      console.error('Authentication error:', error);
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
      console.log(`Authenticating with Audible for marketplace: ${credentials.country}`);
      
      const params = new URLSearchParams({
        'auth_country': credentials.country,
        'client_id': this.CLIENT_ID,
        'grant_type': 'password',
        'username': credentials.email,
        'password': credentials.password,
        'scope': 'all:device'
      })
      
      console.log('Making authentication request to Audible...');
      
      const response = await axios.post(
        `${this.BASE_URL}/auth/token`, 
        params.toString(),
        {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 30000 // 30 seconds timeout
        }
      )
      
      if (response.status === 200 && response.data) {
        console.log('Authentication successful');
        return response.data as AudibleTokens
      }
      
      console.error('Authentication failed, response status:', response.status);
      return null
    } catch (error) {
      console.error('Error getting Audible tokens:', error);
      throw new Error('Failed to authenticate with Audible')
    }
  }
  
  /**
   * Generate a new RSA private key
   */
  private generatePrivateKey(): string {
    console.log('Generating new RSA private key...');
    const key = new jsrsasign.KJUR.asn1.x509.PrivateKeyInfo()
    const rsaKey = new jsrsasign.RSAKey()
    rsaKey.generate(2048, '10001')
    key.setRSAKey(rsaKey)
    return key.getPEM() // Get PEM format with private key
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
      console.log('Preparing to register device with Audible...');
      
      // Generate device public key from private key
      const rsaKey = jsrsasign.KEYUTIL.getKey(privateKey) as jsrsasign.RSAKey
      
      const pubKey = jsrsasign.KEYUTIL.getPEM(rsaKey)
      console.log('Generated public key from private key');
      
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
      
      console.log('Sending device registration request to Audible...');
      const response = await axios.post(
        `${this.BASE_URL}/device/registerDevice`,
        deviceData,
        {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: 30000 // 30 seconds timeout
        }
      )
      
      console.log('Device registration response status:', response.status);
      
      if (response.status === 200 && response.data && response.data.adp_token) {
        // Store this device registration
        this.registeredDevices.set(serialNumber, response.data.adp_token)
        console.log('Successfully received ADP token from Audible');
        return response.data.adp_token
      }
      
      console.error('Failed to get ADP token from response');
      return null
    } catch (error) {
      console.error('Error registering device:', error);
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
      console.log(`Configuration saved to file: ${filePath}`);
      return true
    } catch (error) {
      console.error('Error saving config to file:', error)
      return false
    }
  }
}

// Export router to register with Fastify
export default async function registerAudibleAuthRoutes(fastify: FastifyInstance) {
  console.log('Registering Audible authentication routes');
  
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try {
      const json = JSON.parse(body as string)
      done(null, json)
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { statusCode?: number }
        err.statusCode = 400
        done(err, undefined)
      } else {
        const err = new Error('Invalid JSON')
        ;(err as Error & { statusCode?: number }).statusCode = 400
        done(err, undefined)
      }
    }
  })
  
  const authHelper = new AudibleAuthHelper()
  
  // Route to serve the authentication UI
  fastify.get('/auth/audible', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('Serving Audible authentication UI');
    
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
        
        <form id="authForm" method="post" action="javascript:void(0);">
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
        
        <button type="button" id="testButton" style="margin-top: 10px; background-color: #007bff; color: white; padding: 10px 15px; border: none; cursor: pointer;">Test Button</button>
        
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
          document.addEventListener('DOMContentLoaded', function() {
            console.log('DOM fully loaded - setting up event listeners');
            
            const form = document.getElementById('authForm');
            console.log('Form element found:', !!form);
            
            if (form) {
              form.addEventListener('submit', async function(e) {
                console.log('Form submission triggered');
                e.preventDefault();
                
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const country = document.getElementById('country').value;
                
                console.log('Form data collected, attempting fetch to:', '/auth/audible/generate');
                console.log('Email:', email);
                console.log('Country:', country);
                
                try {
                  console.log('Starting fetch request...');
                  const response = await fetch('/auth/audible/generate', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, password, country })
                  });
                  
                  console.log('Response received:', response.status);
                  
                  if (!response.ok) {
                    throw new Error(\`Server responded with status: \${response.status}\`);
                  }
                  
                  const result = await response.json();
                  console.log('Parsed JSON result:', result);
                  
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
                  console.error('Fetch error:', error);
                  alert('An error occurred while authenticating: ' + error.message);
                }
              });
              
              console.log('Event listener attached to form');
            } else {
              console.error('Form element not found!');
            }
            
            // Test button functionality directly
            const testBtn = document.getElementById('testButton');
            if (testBtn) {
              testBtn.addEventListener('click', function() {
                console.log('Test button clicked');
                alert('Test button works!');
              });
              console.log('Event listener attached to test button');
            } else {
              console.error('Test button element not found!');
            }
          });
        </script>
      </body>
      </html>
    `;
    
    return reply.type('text/html').send(html);
  });
  
  // API endpoint to generate authentication tokens
  fastify.post('/auth/audible/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('Received request to /auth/audible/generate:', request.body);
    
    const body = request.body as AudibleAuthCredentials;
    
    if (!body || !body.email || !body.password || !body.country) {
      console.error('Missing required fields in request:', body);
      return reply.code(400).send({
        success: false,
        message: 'Email, password, and country are required'
      });
    }
    
    console.log(`Processing authentication request for ${body.email} in ${body.country}`);
    
    try {
      const result = await authHelper.authenticate(body);
      console.log('Authentication result:', { success: result.success });
      
      if (result.success) {
        console.log('Authentication successful, sending response');
      } else {
        console.log('Authentication failed:', result.message);
      }
      
      return reply.send(result);
    } catch (error) {
      console.error('Authentication error:', error);
      return reply.code(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Authentication failed'
      });
    }
  });
  
  console.log('Audible authentication routes registered successfully');
}
