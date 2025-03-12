import axios from 'axios'
import * as crypto from 'crypto'
import jsrsasign from 'jsrsasign'
import * as fs from 'fs'

export interface AudibleAuthCredentials {
  email: string
  password: string
  country: string
}

export interface AudibleAuthResponse {
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
    // @ts-ignore - TypeScript doesn't recognize the structure correctly
    const key = new jsrsasign.KJUR.crypto.RSAKey()
    // @ts-ignore
    key.generate(2048, '10001') // Generate 2048-bit RSA key
    // @ts-ignore - TypeScript doesn't recognize the options parameter correctly
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
      // @ts-ignore - TypeScript doesn't recognize the structure correctly
      const privKeyObj = jsrsasign.KEYUTIL.getKey(privateKey)
      // @ts-ignore
      if (!(privKeyObj instanceof jsrsasign.RSAKey)) {
        throw new Error('Failed to generate valid RSA key')
      }
      
      // @ts-ignore
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
