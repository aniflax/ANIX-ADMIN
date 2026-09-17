import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import AccountManagement from '../../../src/pages/admin/AccountManagement.jsx';

const { apiGet, apiPost, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('../../../src/api/axios', () => ({
  default: {
    get: apiGet,
    post: apiPost,
    delete: apiDelete,
  },
}));

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

describe('AccountManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation((url) => {
      if (url === '/api/employees/admin/accounts') {
        return Promise.resolve({
          data: [
            {
              id: 'employee-1',
              employee_id: 10006,
              first_name: 'Teja',
              last_name: 'Krishna',
              email: 'employee@example.com',
              email_verified: true,
              role: 'EMPLOYEE',
              status: 'ACTIVE',
              failed_login_attempts: 0,
              last_login: null,
            },
            {
              id: 'employee-2',
              employee_id: 10007,
              first_name: 'Pending',
              last_name: 'User',
              email: 'pending@example.com',
              email_verified: false,
              role: 'EMPLOYEE',
              status: 'ACTIVE',
              failed_login_attempts: 1,
              last_login: null,
            },
          ],
        });
      }
      if (url === '/api/employees/admin/locked-list') {
        return Promise.resolve({
          data: [
            {
              id: 'locked-1',
              employee_id: 10006,
              first_name: 'Teja',
              last_name: 'Krishna',
              email: 'employee@example.com',
              email_verified: true,
              phone: '9999999999',
              lock_reason: 'Too many attempts',
              locked_at: '2026-04-21T10:30:00Z',
              reset_pending: false,
            },
          ],
        });
      }
      if (url === '/api/employees/admin/delete-requests') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    apiPost.mockImplementation((url) => {
      if (url === '/api/employees/admin/accounts/otp/send') {
        return Promise.resolve({
          data: {
            email: 'admin@example.com',
            otp_token: 'otp-token',
            message: 'OTP sent to admin@example.com.',
          },
        });
      }
      if (url === '/api/employees/admin/accounts/otp/verify') {
        return Promise.resolve({
          data: {
            email: 'admin@example.com',
            email_verification_token: 'verified-email-token',
            message: 'Email verified.',
          },
        });
      }
      if (url === '/api/employees/admin/accounts') {
        return Promise.resolve({
          data: {
            account: {
              id: 'admin-1',
              employee_id: 10001,
              first_name: 'Admin',
              last_name: 'User',
              email: 'admin@example.com',
              email_verified: false,
              role: 'ADMIN',
              status: 'INACTIVE',
            },
            temporary_password: 'TempPass123',
            invitation_sent: true,
            message: 'ADMIN account 10001 created.',
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    apiDelete.mockResolvedValue({ data: {} });
  });

  it('shows verification badges for accounts and locked accounts', async () => {
    render(<AccountManagement />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/Account Management/i)).toBeInTheDocument();
    expect(await screen.findByTitle('Email verified')).toBeInTheDocument();
    expect(await screen.findByTitle('Email not verified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Locked Accounts/i }));
    expect(await screen.findByText(/Too many attempts/i)).toBeInTheDocument();
  });

  it('allows SuperAdmin to create an Admin or HR account from Account Management', async () => {
    render(<AccountManagement />, { wrapper: MemoryRouter });

    fireEvent.click(await screen.findByRole('button', { name: /Add Account/i }));

    expect(screen.getByText(/Verify Email/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Email ID/i), { target: { value: 'ADMIN@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/employees/admin/accounts/otp/send', {
        email: 'admin@example.com',
      }, { skipAuthLogout: true });
    });
    expect(await screen.findByText(/Enter OTP/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/OTP/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify OTP/i }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/employees/admin/accounts/otp/verify', {
        email: 'admin@example.com',
        otp: '123456',
        otp_token: 'otp-token',
      }, { skipAuthLogout: true });
    });
    expect(await screen.findByText(/Account Information/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/employees/admin/accounts', {
        account_id: null,
        role: 'HR',
        first_name: 'Admin',
        last_name: 'User',
        phone: '9999999999',
        email: 'admin@example.com',
        email_verification_token: 'verified-email-token',
        send_invitation: true,
      }, { skipAuthLogout: true });
    });
    expect(await screen.findByText(/One-time password/i)).toBeInTheDocument();
    expect(screen.getByText('TempPass123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mail Login Details/i }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/employees/admin/accounts/admin-1/send-credentials', {
        temporary_password: 'TempPass123',
      }, { skipAuthLogout: true });
    });
  });

  it('opens the selected account profile from row actions', async () => {
    render(<AccountManagement />, { wrapper: MemoryRouter });

    fireEvent.click(await screen.findByLabelText(/Actions for Teja Krishna/i));
    const profileLink = await screen.findByRole('menuitem', { name: /Profile/i });
    expect(profileLink).toHaveAttribute('href', '/profile/employee-1');
  });
});
