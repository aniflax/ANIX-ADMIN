import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Grid, IconButton, List, ListItem, ListItemText, Divider, Autocomplete, Alert, Card, CardContent
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import api from '../../api/axios';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Departments() {
  const location = useLocation();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialogs
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editDept, setEditDept] = useState(null);
  const [viewDept, setViewDept] = useState(null);
  const [deptEmployees, setDeptEmployees] = useState([]);

  // Dialog-local error states
  const [addError, setAddError] = useState('');
  const [editError, setEditError] = useState('');

  // Form states
  const [addForm, setAddForm] = useState({ name: '', description: '', hod_id: '', office_ids: [] });
  const [editForm, setEditForm] = useState({ name: '', description: '', hod_id: '', office_ids: [] });

  // Location in view
  const [selectedLocationId, setSelectedLocationId] = useState('');

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (!location.state?.viewDepartmentId || departments.length === 0) return;
    const targetDepartment = departments.find((departmentItem) => departmentItem.id === location.state.viewDepartmentId);
    if (targetDepartment) {
      openViewModal(targetDepartment);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [departments, location.pathname, location.state, navigate]);

  const fetchData = async () => {
    try {
      const [deptRes, employeesRes, locRes] = await Promise.all([
        api.get('/api/departments/'),
        api.get('/api/employees/'),
        api.get('/api/locations/')
      ]);
      setDepartments(deptRes.data.sort((a, b) => a.name.localeCompare(b.name)));
      setAllEmployees(employeesRes.data);
      setAllLocations(locRes.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // ADD
  const openAddDialog = () => {
    setAddForm({ name: '', description: '', hod_id: '', office_ids: [] });
    setAddError('');
    setIsAddOpen(true);
  };

  const handleCreate = async () => {
    setAddError('');
    try {
      const res = await api.post('/api/departments/', {
        name: addForm.name,
        description: addForm.description,
        hod_id: addForm.hod_id || null
      });
      const newDeptId = res.data.id;
      for (const locId of addForm.office_ids) {
        await api.post(`/api/departments/${newDeptId}/locations`, { location_id: locId, is_primary: false });
      }
      setIsAddOpen(false);
      setSuccess('Department created');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setAddError(err.response?.data?.detail || 'Failed to create');
    }
  };

  // EDIT
  const openEditDialog = (dept) => {
    setEditError('');
    setEditDept(dept);
    setEditForm({
      name: dept.name,
      description: dept.description || '',
      hod_id: dept.hod_id || '',
      office_ids: dept.locations?.map(l => l.id) || []
    });
  };

  const handleEdit = async () => {
    setEditError('');
    try {
      // Update department info including HOD
      await api.put(`/api/departments/${editDept.id}`, {
        name: editForm.name,
        description: editForm.description,
        hod_id: editForm.hod_id || null
      });

      // Sync locations
      const currentLocIds = editDept.locations?.map(l => l.id) || [];
      const newLocIds = editForm.office_ids;

      // Remove locations no longer selected
      for (const locId of currentLocIds) {
        if (!newLocIds.includes(locId)) {
          await api.delete(`/api/departments/${editDept.id}/locations/${locId}`).catch(e => console.log('Remove location error:', e));
        }
      }

      // Add new locations
      for (const locId of newLocIds) {
        if (!currentLocIds.includes(locId)) {
          await api.post(`/api/departments/${editDept.id}/locations`, { location_id: locId, is_primary: false }).catch(e => console.log('Add location error:', e));
        }
      }

      setEditDept(null);
      setSuccess('Department updated');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setEditError(err.response?.data?.detail || 'Failed to update');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this department?')) return;
    try {
      await api.delete(`/api/departments/${id}`);
      setSuccess('Department deactivated');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete');
    }
  };

  // VIEW
  const openViewModal = async (dept) => {
    // First get fresh department data
    try {
      const deptRes = await api.get(`/api/departments/${dept.id}`);
      setViewDept(deptRes.data);
      const employeesRes = await api.get(`/api/employees/?department_id=${dept.id}`);
      setDeptEmployees(employeesRes.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load department details');
    }
  };

  const refreshViewDept = async () => {
    if (!viewDept) return;
    try {
      const deptRes = await api.get(`/api/departments/${viewDept.id}`);
      setViewDept(deptRes.data);
    } catch (err) {
      console.error('Failed to refresh department', err);
    }
  };

  const handleAddLocation = async () => {
    try {
      await api.post(`/api/departments/${viewDept.id}/locations`, { location_id: selectedLocationId, is_primary: false });
      setSelectedLocationId('');
      await refreshViewDept();
      fetchData();
      setSuccess('Location added');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add location');
    }
  };

  const handleRemoveLocation = async (locationId) => {
    if (!confirm('Remove this location?')) return;
    try {
      await api.delete(`/api/departments/${viewDept.id}/locations/${locationId}`);
      await refreshViewDept();
      fetchData();
      setSuccess('Location removed');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove location');
    }
  };

  const handleSetPrimary = async (locationId, isPrimary) => {
    try {
      await api.put(`/api/departments/${viewDept.id}/locations/${locationId}`, { location_id: locationId, is_primary: isPrimary });
      await refreshViewDept();
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update');
    }
  };

  const promoteToHod = async (employeeId) => {
    try {
      await api.put(`/api/departments/${viewDept.id}`, { hod_id: employeeId });
      await refreshViewDept();
      fetchData();
      setSuccess('Employee promoted to HOD');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to promote');
    }
  };

  const deactivateEmployee = async (employeeId) => {
    try {
      await api.put(`/api/employees/${employeeId}/admin`, { department_id: null, role: 'EMPLOYEE' });
      const res = await api.get(`/api/employees/?department_id=${viewDept.id}`);
      setDeptEmployees(res.data);
      setSuccess('Employee removed from department');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove');
    }
  };

  const [employeesToAdd, setEmployeesToAdd] = useState([]);
  const [addEmployeeLoading, setAddEmployeeLoading] = useState(false);

  const getAvailableEmployees = () => allEmployees.filter((employee) => !employee.department_id);

  const handleAddEmployees = async () => {
    if (employeesToAdd.length === 0 || !viewDept) return;
    setAddEmployeeLoading(true);
    try {
      for (const employee of employeesToAdd) {
        await api.put(`/api/employees/${employee.id}/admin`, { department_id: viewDept.id });
      }
      setEmployeesToAdd([]);
      const [deptRes, employeesRes, deptEmployeesRes] = await Promise.all([
        api.get(`/api/departments/${viewDept.id}`),
        api.get('/api/employees/'),
        api.get(`/api/employees/?department_id=${viewDept.id}`),
      ]);
      setViewDept(deptRes.data);
      setAllEmployees(employeesRes.data);
      setDeptEmployees(deptEmployeesRes.data);
      fetchData();
      setSuccess(`Added ${employeesToAdd.length} employee${employeesToAdd.length === 1 ? '' : 's'} to ${viewDept.name}`);
      setTimeout(() => setSuccess(''), 2500);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to allocate employees');
    } finally {
      setAddEmployeeLoading(false);
    }
  };

  const getAvailableLocations = () => {
    if (!viewDept?.locations) return allLocations;
    const assignedIds = viewDept.locations.map(l => l.id);
    return allLocations.filter(l => !assignedIds.includes(l.id));
  };

  const getEmployeeName = (employeeId) => {
    const employee = allEmployees.find(s => s.id === employeeId);
    return employee ? `${employee.first_name} ${employee.last_name}` : null;
  };

  const getHodCandidateOptions = () => allEmployees.filter((employee) => employee.role === 'EMPLOYEE');

  if (loading) return <CircularProgress />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} gap={2} flexDirection={{ xs: 'column', sm: 'row' }}>
        <Typography variant="h4" fontWeight="bold" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>Departments</Typography>
        <Button variant="contained" onClick={openAddDialog} sx={{ width: { xs: '100%', sm: 'auto' } }}>+ Add Department</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 760 }}>
          <TableHead sx={{ bgcolor: 'background.default' }}>
            <TableRow>
              <TableCell><b>Name</b></TableCell>
              <TableCell><b>Description</b></TableCell>
              <TableCell><b>HOD</b></TableCell>
              <TableCell><b>Offices</b></TableCell>
              <TableCell><b>Employees</b></TableCell>
              <TableCell align="center"><b>Actions</b></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.map((dept) => (
              <TableRow key={dept.id}>
                <TableCell>
                  <Button size="small" onClick={() => openViewModal(dept)} sx={{ textTransform: 'none', fontWeight: 'bold' }}>
                    {dept.name}
                  </Button>
                </TableCell>
                <TableCell>{dept.description || '-'}</TableCell>
                <TableCell>{getEmployeeName(dept.hod_id) || <Typography variant="caption" color="text.secondary">Unassigned</Typography>}</TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {dept.locations?.length > 0 ? dept.locations.map((loc) => (
                      <Chip key={loc.id} label={loc.name} size="small" color={loc.is_primary ? "primary" : "default"} icon={<LocationOnIcon />} />
                    )) : <Typography variant="caption" color="text.secondary">None</Typography>}
                  </Box>
                </TableCell>
                <TableCell>{dept.employee_count}</TableCell>
                <TableCell align="center">
                  <IconButton size="small" color="primary" onClick={() => openEditDialog(dept)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(dept.id)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onClose={() => setIsAddOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}>
        <DialogTitle>Add Department</DialogTitle>
        <DialogContent>
          <Box pt={2} display="flex" flexDirection="column" gap={2}>
            {addError && <Alert severity="error">{addError}</Alert>}
            <TextField label="Name" fullWidth required value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            <TextField label="Description" fullWidth multiline rows={2} value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
            <Autocomplete
              options={getHodCandidateOptions()}
              getOptionLabel={(opt) => `${opt.first_name} ${opt.last_name} (${opt.employee_id})`}
              value={getHodCandidateOptions().find(s => s.id === addForm.hod_id) || null}
              onChange={(e, val) => setAddForm({ ...addForm, hod_id: val?.id || '' })}
              renderInput={(params) => <TextField {...params} label="Assign HOD" />}
            />
            <Autocomplete
              multiple
              options={allLocations}
              getOptionLabel={(opt) => opt.name}
              value={allLocations.filter(l => addForm.office_ids.includes(l.id))}
              onChange={(e, val) => setAddForm({ ...addForm, office_ids: val.map(v => v.id) })}
              renderInput={(params) => <TextField {...params} label="Offices" placeholder="Select offices" />}
              renderTags={(value, getTagProps) => value.map((opt, index) => <Chip {...getTagProps({ index })} key={opt.id} label={opt.name} size="small" />)}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, pb: 3, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
          <Button onClick={() => setIsAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!addForm.name}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editDept} onClose={() => setEditDept(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}>
        <DialogTitle>Edit Department</DialogTitle>
        <DialogContent>
          <Box pt={2} display="flex" flexDirection="column" gap={2}>
            {editError && <Alert severity="error">{editError}</Alert>}
            <TextField label="Name" fullWidth required value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <TextField label="Description" fullWidth multiline rows={2} value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            <Autocomplete
              options={getHodCandidateOptions()}
              getOptionLabel={(opt) => `${opt.first_name} ${opt.last_name} (${opt.employee_id})`}
              value={getHodCandidateOptions().find(s => s.id === editForm.hod_id) || null}
              onChange={(e, val) => setEditForm({ ...editForm, hod_id: val?.id || '' })}
              renderInput={(params) => <TextField {...params} label="Assign HOD" />}
            />
            <Autocomplete
              multiple
              options={allLocations}
              getOptionLabel={(opt) => opt.name}
              value={allLocations.filter(l => editForm.office_ids.includes(l.id))}
              onChange={(e, val) => setEditForm({ ...editForm, office_ids: val?.map(v => v.id) || [] })}
              renderInput={(params) => <TextField {...params} label="Offices" placeholder="Select offices" />}
              renderTags={(value, getTagProps) => value.map((opt, index) => <Chip {...getTagProps({ index })} key={opt.id} label={opt.name} size="small" />)}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, pb: 3, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
          <Button onClick={() => setEditDept(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleEdit}>Update</Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewDept} onClose={() => setViewDept(null)} maxWidth="md" fullWidth PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}>
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">{viewDept?.name}</Typography>
          <Typography variant="subtitle2" color="text.secondary">{viewDept?.description}</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} sm={4}>
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography color="text.secondary" variant="caption">Employees</Typography>
                <Typography variant="h6">{deptEmployees.length}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography color="text.secondary" variant="caption">HOD</Typography>
                <Typography variant="h6">{getEmployeeName(viewDept?.hod_id) || 'None'}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography color="text.secondary" variant="caption">Offices</Typography>
                <Typography variant="h6">{viewDept?.locations?.length || 0}</Typography>
              </Paper>
            </Grid>
          </Grid>

          <Typography variant="h6" mb={2}>Assigned Offices</Typography>
          <Box display="flex" gap={1} flexWrap="wrap" mb={3}>
            {viewDept?.locations?.length > 0 ? viewDept.locations.map((loc) => (
              <Card key={loc.id} variant="outlined" sx={{ minWidth: { xs: '100%', sm: 200 }, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <LocationOnIcon color={loc.is_primary ? "primary" : "action"} />
                    <Typography fontWeight="bold">{loc.name}</Typography>
                    {loc.is_primary && <Chip label="Primary" size="small" color="primary" />}
                  </Box>
                  <Box display="flex" gap={1}>
                    <Button size="small" onClick={() => handleSetPrimary(loc.id, !loc.is_primary)}>
                      {loc.is_primary ? 'Unset Primary' : 'Set Primary'}
                    </Button>
                    <Button size="small" color="error" onClick={() => handleRemoveLocation(loc.id)}>Remove</Button>
                  </Box>
                </CardContent>
              </Card>
            )) : <Typography color="text.secondary">No offices assigned</Typography>}
          </Box>

          {getAvailableLocations().length > 0 && (
            <Box display="flex" gap={2} alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} flexDirection={{ xs: 'column', sm: 'row' }}>
              <Autocomplete
                options={getAvailableLocations()}
                getOptionLabel={(opt) => opt.name}
                value={allLocations.find(l => l.id === selectedLocationId) || null}
                onChange={(e, val) => setSelectedLocationId(val?.id || '')}
                renderInput={(params) => <TextField {...params} label="Add Office" size="small" />}
                sx={{ flex: 1 }}
              />
              <Button variant="contained" size="small" onClick={handleAddLocation} disabled={!selectedLocationId} sx={{ width: { xs: '100%', sm: 'auto' } }}>Add</Button>
            </Box>
          )}

          <Typography variant="h6" mb={2}>Allocate Employees</Typography>
          {getAvailableEmployees().length > 0 ? (
            <Box display="flex" gap={2} alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} flexDirection={{ xs: 'column', sm: 'row' }}>
              <Autocomplete
                multiple
                options={getAvailableEmployees()}
                getOptionLabel={(opt) => `${opt.first_name} ${opt.last_name} (${opt.employee_id})`}
                value={employeesToAdd}
                onChange={(e, val) => setEmployeesToAdd(val)}
                renderInput={(params) => <TextField {...params} label="Add unassigned employees" size="small" placeholder="Select employees" />}
                renderTags={(value, getTagProps) => value.map((opt, index) => (
                  <Chip {...getTagProps({ index })} key={opt.id} label={`${opt.first_name} ${opt.last_name}`} size="small" />
                ))}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                size="small"
                onClick={handleAddEmployees}
                disabled={employeesToAdd.length === 0 || addEmployeeLoading}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                {addEmployeeLoading ? 'Adding...' : 'Add Employee'}
              </Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" mb={3}>No unassigned employees available.</Typography>
          )}

          <Typography variant="h6" mb={2}>Allocated Employees</Typography>
          <List>
            {deptEmployees.map((s, idx) => (
              <React.Fragment key={s.id}>
                <ListItem
                  sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1.5, sm: 0 } }}
                  secondaryAction={null}
                >
                  <ListItemText primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <b>{s.first_name} {s.last_name} ({s.employee_id})</b>
                      {viewDept?.hod_id === s.id && <Chip label="HOD" size="small" color="error" />}
                    </Box>
                  }
                    secondary={`Role: ${s.role} | Status: ${s.status}`} />
                  <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' }, flexDirection: { xs: 'column', sm: 'row' } }}>
                    <Button variant="outlined" size="small" color="primary" sx={{ mr: 1 }}
                      onClick={() => promoteToHod(s.id)} disabled={s.role !== 'EMPLOYEE'}>Promote to HOD</Button>
                    <Button variant="outlined" size="small" color="error" onClick={() => deactivateEmployee(s.id)}>Remove</Button>
                  </Box>
                </ListItem>
                {idx < deptEmployees.length - 1 && <Divider />}
              </React.Fragment>
            ))}
            {deptEmployees.length === 0 && <Typography color="text.secondary" px={2}>No employees allocated.</Typography>}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDept(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
