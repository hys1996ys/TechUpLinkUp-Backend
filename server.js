const express = require('express');
const session = require('cookie-session');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Allow requests from your frontend domain
const allowedOrigins = [
  'https://techuplinkup.com',
  'https://www.techuplinkup.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Session configuration
app.use(session({
  name: 'session',
  keys: ['key1', 'key2'],
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'none',
  secure: true,
  domain: '.techuplinkup.com' // Ensures cookie is valid for both www and non-www
}));

// Root route for testing Render deployment
app.get('/', (req, res) => {
  res.send('✅ Backend is up and running!');
});

// OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);


const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Step 1: Redirect to Google OAuth
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

// Step 2: Handle callback from Google
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Use tokens to get user's Google email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();
    const email = profile?.email;

    if (!email) throw new Error('No email from Google');

    // Get Supabase user by email (from 'profiles' table)
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (error || !users) {
      console.error('Supabase user lookup failed:', error);
      return res.status(401).send('User not found in Supabase');
    }

    const userId = users.id;

    // Save Google tokens to Supabase
    const { error: upsertError } = await supabase
      .from('google_tokens')
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      });

    if (upsertError) {
      console.error('Error saving tokens:', upsertError);
      return res.status(500).send('Token save failed');
    }

    console.log('✅ Google tokens saved for:', email);
    return res.redirect(process.env.FRONTEND_URL);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).send('OAuth failed');
  }
});


// Step 3: Create a Google Meet via Calendar API
app.post('/api/create-google-meet', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid Supabase token' });

  const userId = user.user.id;

  const { data: storedTokens, error: tokenError } = await supabase
    .from('google_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (tokenError || !storedTokens) {
    return res.status(403).json({ error: 'Google tokens not found' });
  }

  // Set credentials to OAuth client
  oauth2Client.setCredentials({
    access_token: storedTokens.access_token,
    refresh_token: storedTokens.refresh_token,
    scope: storedTokens.scope,
    token_type: storedTokens.token_type,
    expiry_date: storedTokens.expiry_date
  });

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60000); // 30 min later

    const event = {
      summary: 'Mentorship Session',
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1
    });

    return res.json({ meetLink: response.data.hangoutLink });
  } catch (err) {
    console.error('Meet creation failed:', err);
    return res.status(500).json({ error: 'Meet creation failed' });
  }
});


// Add an endpoint to check Google OAuth authentication status
app.get('/api/check-auth', (req, res) => {
  if (req.session && req.session.tokens) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// Start the server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

