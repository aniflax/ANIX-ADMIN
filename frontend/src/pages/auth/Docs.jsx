import React from 'react';
import { Container, Paper, Typography, Box, Card, CardActionArea, CardContent, Chip } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import BadgeIcon from '@mui/icons-material/Badge';
import EngineeringIcon from '@mui/icons-material/Engineering';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import SupervisedUserCircleIcon from '@mui/icons-material/SupervisedUserCircle';
import { useAuth } from '../../context/AuthContext';

const roleHierarchy = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'HR', 'HOD', 'EMPLOYEE'],
  ADMIN: ['ADMIN', 'HR', 'HOD', 'EMPLOYEE'],
  HR: ['HR', 'HOD', 'EMPLOYEE'],
  HOD: ['HOD', 'EMPLOYEE'],
  EMPLOYEE: ['EMPLOYEE'],
};

const manuals = [
  { title: 'Employee User Manual', file: 'Employee User Manual.html', icon: <BadgeIcon />, color: '#2e7d32', desc: 'Guide for Employees on attendance, leaves, profile, and swaps.', minRole: null },
  { title: 'HOD User Manual', file: 'HOD User Manual.html', icon: <EngineeringIcon />, color: '#7b1fa2', desc: 'Guide for HODs on team management, approvals, and swaps.', minRole: 'HOD' },
  { title: 'HR User Manual', file: 'HR User Manual.html', icon: <SupportAgentIcon />, color: '#1565c0', desc: 'Guide for HR on directory, leave admin, departments, and notifications.', minRole: 'HR' },
  { title: 'Admin User Manual', file: 'Admin User Manual.html', icon: <AdminPanelSettingsIcon />, color: '#d66a18', desc: 'Guide for Admins on account management, departments, locations, and config.', minRole: 'ADMIN' },
  { title: 'SuperAdmin User Manual', file: 'SuperAdmin User Manual.html', icon: <SupervisedUserCircleIcon />, color: '#c62828', desc: 'Guide for SuperAdmins on system config, HR management, and all features.', minRole: 'SUPER_ADMIN' },
];

function canAccess(userRole, minRole) {
  if (!minRole) return true;
  if (!userRole) return false;
  return roleHierarchy[userRole]?.includes(minRole) || false;
}

export default function Docs() {
  const { user } = useAuth();
  const userRole = user?.role || null;

  const accessibleManuals = manuals.filter((m) => canAccess(userRole, m.minRole));

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper sx={{ p: 4, borderRadius: 3 }}>
        <Box display="flex" alignItems="center" gap={1.5} mb={1}>
          <MenuBookIcon sx={{ fontSize: 36, color: '#d66a18' }} />
          <Typography variant="h4" fontWeight={700}>User Manuals</Typography>
        </Box>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {userRole
            ? `Showing manuals accessible to your role: ${userRole.replace('_', ' ')}`
            : 'Showing publicly available manuals. Log in to access role-specific manuals.'}
        </Typography>

        <Box display="flex" flexDirection="column" gap={2}>
          {accessibleManuals.map((m) => (
            <Card key={m.file} variant="outlined" sx={{ borderColor: 'grey.200' }}>
              <CardActionArea
                component="a"
                href={`/docs/${m.file}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ py: 2, px: 2.5 }}
              >
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: '0 !important' }}>
                  <Box sx={{ color: m.color, display: 'flex', alignItems: 'center' }}>
                    {m.icon}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" fontWeight={600}>{m.title}</Typography>
                    <Typography variant="body2" color="text.secondary">{m.desc}</Typography>
                  </Box>
                  <Chip label="Open" size="small" sx={{ flexShrink: 0 }} />
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>

        {!userRole && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              <strong>HR, Admin, SuperAdmin?</strong> <a href="/login">Log in</a> to access additional role-specific manuals.
            </Typography>
          </Box>
        )}
      </Paper>
    </Container>
  );
}
