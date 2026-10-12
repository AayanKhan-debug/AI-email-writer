import { useState } from 'react'
import './App.css'
import { Box, Button, CircularProgress, Container, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import axios from 'axios';

function App() {
  const [emailContent, setEmailContent] = useState('');
  const [tone, setTone] = useState('Professional');
  const [length, setLength] = useState('Medium');
  const [generatedReply, setGeneratedReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.post("http://localhost:8080/api/email/generate", {
       emailContent,
       tone,
       length
      });
      setGeneratedReply(typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
    } catch (error) {
      setError(error.response?.data || 'Failed to generate email reply. Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{py:4}}>
      <Typography variant='h3' component="h1" gutterBottom>
        Email Reply Generator
      </Typography>

      <Box sx={{ mx: 3 }}>
        <TextField 
          fullWidth
          multiline
          rows={6}
          variant='outlined'
          label="Original Email Content"
          value={emailContent || ''}
          onChange={(e) => setEmailContent(e.target.value)}
          sx={{ mb:2 }}/>

          <FormControl fullWidth sx={{ mb:2 }}>
            <InputLabel id="tone-label">Tone</InputLabel>
            <Select
              id="tone"
              labelId="tone-label"
              value={tone}
              label="Tone"
              onChange={(e) => setTone(e.target.value)}>
                <MenuItem value="Professional">Professional</MenuItem>
                <MenuItem value="Friendly">Friendly</MenuItem>
                <MenuItem value="Formal">Formal</MenuItem>
                <MenuItem value="Casual">Casual</MenuItem>
                <MenuItem value="Apologetic">Apologetic</MenuItem>
                <MenuItem value="Persuasive">Persuasive</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb:2 }}>
            <InputLabel id="length-label">Reply length</InputLabel>
            <Select
              id="reply-length"
              labelId="length-label"
              value={length}
              label="Reply length"
              onChange={(e) => setLength(e.target.value)}>
                <MenuItem value="Short">Short — 1–2 concise sentences</MenuItem>
                <MenuItem value="Medium">Medium — 3–5 sentences</MenuItem>
                <MenuItem value="Detailed">Detailed — context and next steps</MenuItem>
            </Select>
          </FormControl>

          <Button
            variant='contained'
            onClick={handleSubmit}
            disabled={!emailContent || loading}
            fullWidth>
            {loading ? <CircularProgress size={24}/> : "Generate Reply"}
          </Button>
      </Box>

      {error && (
        <Typography color='error' sx={{ mb:2 }}>
          {error}
        </Typography>
      )}

      {generatedReply && (
       <Box sx={{ mt: 3}}>
          <Typography variant='h6' gutterBottom>
            Generated Reply:
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={6}
            variant='outlined'
            value={generatedReply || ''}
            inputProps={{ readOnly: true }}/>
        
        <Button
          variant='outlined'
          sx={{ mt: 2 }}
          onClick={() => navigator.clipboard.writeText(generatedReply)}>
            Copy to Clipboard
        </Button>
       </Box> 
      )}
    </Container>
  )
}

export default App