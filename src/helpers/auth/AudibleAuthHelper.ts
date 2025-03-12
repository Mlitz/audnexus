import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AudibleAuthHelper, AudibleAuthCredentials } from './AudibleAuthModel'

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
