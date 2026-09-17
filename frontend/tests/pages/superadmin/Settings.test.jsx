import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import Settings from '../../../src/pages/superadmin/Settings.jsx';

const { apiGet, apiPut, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../../src/api/axios', () => ({
  default: {
    get: apiGet,
    put: apiPut,
    post: apiPost,
  },
}));

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

describe('Settings', () => {
  beforeEach(() => {
    apiGet.mockImplementation((url) => {
      if (url === '/api/config/') {
        return Promise.resolve({
          data: [
            { key: 'GEO_THRESHOLD_METERS', value: '500', description: 'Geo threshold', access_level: 'HR' },
            { key: 'PASSWORD_RESET_LINK_VALIDITY_MINUTES', value: '10', description: 'Reset link validity', access_level: 'SUPER_ADMIN' },
          ],
        });
      }
      if (url === '/api/attendance/reminder/status') {
        return Promise.resolve({
          data: {
            enabled: true,
            deadline_time: '10:30 AM IST',
            official_email: 'no-reply@anix-hrms.example',
            last_sent_date: '2026-04-20',
          },
        });
      }
      if (url === '/api/config/mail') {
        return Promise.resolve({
          data: {
            official_email: 'no-reply@anix-hrms.example',
            smtp_server: 'smtp.gmail.com',
            smtp_port: 587,
            smtp_user: 'no-reply@anix-hrms.example',
            smtp_password_set: true,
            from_name: 'anix HRMS',
            from_email: 'no-reply@anix-hrms.example',
            password_reset_link_validity_minutes: 10,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    apiPut.mockResolvedValue({ data: { message: 'ok' } });
    apiPost.mockResolvedValue({ data: { message: 'ok' } });
  });

  it('renders the mail configuration and reset-link validity field', async () => {
    render(<Settings />);

    expect(await screen.findByText(/Mail Configuration/i, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/Password Reset Link Validity \(Minutes\)/i)).toHaveValue(10);
    expect(screen.getByRole('button', { name: /Send Test Email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Reminder Now/i })).toBeInTheDocument();
  }, 15000);

  it('hides mail transport keys from the generic config grid', async () => {
    render(<Settings />);

    await screen.findByText(/All System Configurations/i);
    expect(screen.queryByText('SMTP_PASSWORD')).not.toBeInTheDocument();
  });
});
