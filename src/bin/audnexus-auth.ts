#!/usr/bin/env node

import { program } from 'commander'
import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import { AudibleAuthHelper } from '#helpers/auth/AudibleAuthHelper'

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

// Promisify readline.question
function question(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer)
    })
  })
}

// Create the auth helper
const authHelper = new AudibleAuthHelper()

async function runInteractive() {
  console.log('\n==== Audnexus - Audible Authentication Tool ====\n')
  
  try {
    const email = await question('Enter your Audible email: ')
    
    // Use silent mode for password
    process.stdout.write('Enter your Audible password: ')
    const password = await new Promise<string>(resolve => {
      let input = ''
      process.stdin.on('data', (data) => {
        const char = data.toString()
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.pause()
          process.stdout.write('\n')
          resolve(input)
        } else if (char === '\u0003') {
          // Ctrl+C
          process.stdout.write('\n')
          process.exit(0)
        } else {
          process.stdout.write('*')
          input += char
        }
      })
      process.stdin.resume()
    })
    
    const countryOptions = ['us', 'uk', 'ca', 'au', 'fr', 'de', 'jp', 'it', 'in', 'es']
    console.log('\nAvailable Audible marketplaces:')
    countryOptions.forEach((code, index) => {
      console.log(`  ${index + 1}. ${code}`)
    })
    
    const countryChoice = await question('Select your Audible marketplace (1-10) [default: 1]: ')
    const countryIndex = parseInt(countryChoice || '1', 10) - 1
    const country = countryOptions[countryIndex] || 'us'
    
    console.log('\nAuthenticating with Audible...')
    
    const result = await authHelper.authenticate({
      email,
      password,
      country
    })
    
    if (result.success && result.adpToken && result.privateKey) {
      console.log('\n✅ Authentication successful!')
      
      console.log('\nGenerated tokens:')
      console.log('ADP_TOKEN:')
      console.log(result.adpToken)
      console.log('\nPRIVATE_KEY:')
      console.log(result.privateKey)
      
      const saveChoice = await question('\nSave these tokens to a file? (y/n) [default: y]: ')
      
      if (saveChoice.toLowerCase() !== 'n') {
        const defaultPath = path.join(process.cwd(), 'audnexus-audible-auth.env')
        const filePath = await question(`Enter file path [default: ${defaultPath}]: `)
        
        const actualPath = filePath || defaultPath
        const saved = await authHelper.saveConfigToFile(
          result.adpToken,
          result.privateKey,
          actualPath
        )
        
        if (saved) {
          console.log(`\n✅ Configuration saved to ${actualPath}`)
          console.log('\nAdd these values to your environment variables:')
          console.log(`ADP_TOKEN=${result.adpToken}`)
          console.log(`PRIVATE_KEY=${result.privateKey}`)
        } else {
          console.log('\n❌ Failed to save configuration file')
        }
      }
    } else {
      console.log('\n❌ Authentication failed:')
      console.log(result.message || 'Unknown error occurred')
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
  } finally {
    rl.close()
  }
}

// Set up command line program
program
  .name('audnexus-auth')
  .description('Generate Audible authentication tokens for audnexus')
  .version('1.0.0')

program
  .command('generate')
  .description('Generate Audible authentication tokens')
  .option('-e, --email <email>', 'Audible account email')
  .option('-p, --password <password>', 'Audible account password')
  .option('-c, --country <country>', 'Audible marketplace country code', 'us')
  .option('-o, --output <file>', 'Output file path for tokens')
  .action(async (options) => {
    if (options.email && options.password) {
      // Non-interactive mode with provided credentials
      try {
        console.log('Authenticating with Audible...')
        
        const result = await authHelper.authenticate({
          email: options.email,
          password: options.password,
          country: options.country || 'us'
        })
        
        if (result.success && result.adpToken && result.privateKey) {
          console.log('✅ Authentication successful!')
          
          if (options.output) {
            const saved = await authHelper.saveConfigToFile(
              result.adpToken,
              result.privateKey,
              options.output
            )
            
            if (saved) {
              console.log(`✅ Configuration saved to ${options.output}`)
            } else {
              console.log('❌ Failed to save configuration file')
            }
          } else {
            console.log('\nAdd these values to your environment variables:')
            console.log(`ADP_TOKEN=${result.adpToken}`)
            console.log(`PRIVATE_KEY=${result.privateKey}`)
          }
        } else {
          console.log('❌ Authentication failed:')
          console.log(result.message || 'Unknown error occurred')
          process.exit(1)
        }
      } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    } else {
      // Interactive mode
      await runInteractive()
    }
  })

// Run the program
program.parse()
