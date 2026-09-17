import React from 'react';
import { Box, Typography, Paper, Card, CardContent, Chip, Avatar, List, ListItem, ListItemIcon, ListItemText, Badge, Tooltip } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import CrownIcon from '@mui/icons-material/EmojiEvents';

/**
 * DEMO: Different HOD Highlight Treatments
 * Choose which one you prefer and we'll implement it in the real component
 */

export default function HODHighlightDemo() {
  const employeesData = [
    { id: '1', name: '10004 - Standard Employee', isHod: false },
    { id: '2', name: '10003 - Head Department', isHod: true },
    { id: '3', name: '10012 - Devika S', isHod: false },
    { id: '4', name: '10011 - Sai Sankalp', isHod: false },
  ];

  return (
    <Box sx={{ p: 3, bgcolor: '#f5f5f5', minHeight: '100vh' }}>
      <Typography variant="h4" fontWeight="bold" mb={4}>
        HOD Highlighting Options - Choose Your Preferred Style
      </Typography>

      {/* Option 1: Badge Approach */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 2, boxShadow: 1 }}>
        <Typography variant="h6" fontWeight="bold" mb={2} color="#d32f2f">
          Option 1: Badge (Red "HOD" Badge on the side)
        </Typography>
        <Box sx={{ bgcolor: '#f9f9f9', p: 2, borderRadius: 2 }}>
          <List>
            {employeesData.map(employee => (
              <ListItem
                key={employee.id}
                sx={{
                  mb: 1,
                  p: 1.5,
                  bgcolor: 'white',
                  borderRadius: 1,
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Typography>{employee.name}</Typography>
                {employee.isHod && (
                  <Chip
                    label="HOD"
                    color="error"
                    size="small"
                    sx={{ fontWeight: 'bold' }}
                  />
                )}
              </ListItem>
            ))}
          </List>
        </Box>
      </Paper>

      {/* Option 2: Color Background */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 2, boxShadow: 1 }}>
        <Typography variant="h6" fontWeight="bold" mb={2} color="#f57c00">
          Option 2: Color Background (Light Orange Background)
        </Typography>
        <Box sx={{ bgcolor: '#f9f9f9', p: 2, borderRadius: 2 }}>
          <List>
            {employeesData.map(employee => (
              <ListItem
                key={employee.id}
                sx={{
                  mb: 1,
                  p: 1.5,
                  bgcolor: employee.isHod ? '#fff3e0' : 'white',
                  borderRadius: 1,
                  border: employee.isHod ? '2px solid #f57c00' : '1px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Typography sx={{ fontWeight: employee.isHod ? 600 : 400 }}>
                  {employee.name}
                </Typography>
                {employee.isHod && (
                  <Typography variant="caption" sx={{ color: '#f57c00', fontWeight: 'bold' }}>
                    (Department Head)
                  </Typography>
                )}
              </ListItem>
            ))}
          </List>
        </Box>
      </Paper>

      {/* Option 3: Bold + Star Icon */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 2, boxShadow: 1 }}>
        <Typography variant="h6" fontWeight="bold" mb={2} color="#1976d2">
          Option 3: Star Icon + Bold Text (Most Elegant)
        </Typography>
        <Box sx={{ bgcolor: '#f9f9f9', p: 2, borderRadius: 2 }}>
          <List>
            {employeesData.map(employee => (
              <ListItem
                key={employee.id}
                sx={{
                  mb: 1,
                  p: 1.5,
                  bgcolor: 'white',
                  borderRadius: 1,
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {employee.isHod && (
                    <Tooltip title="Department Head of Owner">
                      <StarIcon sx={{ color: '#1976d2', fontSize: 24 }} />
                    </Tooltip>
                  )}
                </ListItemIcon>
                <Typography sx={{ fontWeight: employee.isHod ? 700 : 400 }}>
                  {employee.name}
                </Typography>
              </ListItem>
            ))}
          </List>
        </Box>
      </Paper>

      {/* Option 4: Crown Icon */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 2, boxShadow: 1 }}>
        <Typography variant="h6" fontWeight="bold" mb={2} color="#9c27b0">
          Option 4: Crown Icon (Playful & Fun)
        </Typography>
        <Box sx={{ bgcolor: '#f9f9f9', p: 2, borderRadius: 2 }}>
          <List>
            {employeesData.map(employee => (
              <ListItem
                key={employee.id}
                sx={{
                  mb: 1,
                  p: 1.5,
                  bgcolor: 'white',
                  borderRadius: 1,
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {employee.isHod && (
                    <Tooltip title="Department Head">
                      <CrownIcon sx={{ color: '#9c27b0', fontSize: 24 }} />
                    </Tooltip>
                  )}
                </ListItemIcon>
                <Typography sx={{ fontWeight: employee.isHod ? 700 : 400 }}>
                  {employee.name}
                </Typography>
              </ListItem>
            ))}
          </List>
        </Box>
      </Paper>

      {/* Option 5: Avatar Badge */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 2, boxShadow: 1 }}>
        <Typography variant="h6" fontWeight="bold" mb={2} color="#2196f3">
          Option 5: Avatar Badge with Highlight
        </Typography>
        <Box sx={{ bgcolor: '#f9f9f9', p: 2, borderRadius: 2 }}>
          <List>
            {employeesData.map(employee => (
              <ListItem
                key={employee.id}
                sx={{
                  mb: 1,
                  p: 1.5,
                  bgcolor: employee.isHod ? '#e3f2fd' : 'white',
                  borderRadius: 1,
                  border: employee.isHod ? '2px solid #2196f3' : '1px solid #e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2
                }}
              >
                <Badge
                  badgeContent={employee.isHod ? '★' : ''}
                  color="primary"
                  overlap="rectangular"
                  anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                  <Avatar sx={{ bgcolor: employee.isHod ? '#2196f3' : '#9e9e9e' }}>
                    {employee.name.charAt(0)}
                  </Avatar>
                </Badge>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: employee.isHod ? 700 : 400 }}>
                    {employee.name}
                  </Typography>
                  {employee.isHod && (
                    <Typography variant="caption" sx={{ color: '#2196f3', fontWeight: 'bold' }}>
                      Department Head
                    </Typography>
                  )}
                </Box>
              </ListItem>
            ))}
          </List>
        </Box>
      </Paper>

      <Box sx={{ bgcolor: 'white', p: 3, borderRadius: 2, border: '2px solid #4caf50', mb: 4 }}>
        <Typography variant="h6" fontWeight="bold" color="success.main" mb={2}>
          ✓ Recommendation: Option 3 (Star Icon + Bold)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Cleanest, most professional appearance. The star icon is universally recognized as indicating importance/special status. Works well in compact spaces and is immediately recognizable.
        </Typography>
      </Box>
    </Box>
  );
}
