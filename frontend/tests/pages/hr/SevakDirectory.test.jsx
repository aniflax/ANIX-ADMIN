import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import SevakDirectory from '../../../src/pages/hr/SevakDirectory.jsx';

let location = { pathname: '/directory', state: {} };

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
  useAuth: () => ({ user: { role: 'HR' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => location,
  };
});

describe('SevakDirectory', () => {
  beforeEach(() => {
    location = { pathname: '/directory', state: {} };
    apiGet.mockImplementation((url) => {
      if (url === '/api/sevaks/') {
        return Promise.resolve({
          data: [
            {
              id: 'sevak-1',
              sevak_id: 10006,
              first_name: 'Teja',
              last_name: 'Krishna',
              email: 'sevak@example.com',
              email_verified: true,
              role: 'SEVAK',
              status: 'ACTIVE',
              department_id: 'dept-1',
              updated_at: null,
              delete_requested: false,
            },
            {
              id: 'sevak-2',
              sevak_id: 10007,
              first_name: 'Pending',
              last_name: 'User',
              email: 'pending@example.com',
              email_verified: false,
              role: 'SEVAK',
              status: 'ACTIVE',
              department_id: 'dept-1',
              updated_at: null,
              delete_requested: false,
            },
          ],
        });
      }
      if (url === '/api/departments/') {
        return Promise.resolve({
          data: [{ id: 'dept-1', name: 'Operations' }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    apiPut.mockResolvedValue({ data: {} });
    apiPost.mockResolvedValue({ data: {} });
  });

  it('renders verified and unverified email indicators in the directory', async () => {
    render(<SevakDirectory />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/Sevak Directory/i)).toBeInTheDocument();
    expect(await screen.findByTitle('Email verified')).toBeInTheDocument();
    expect(await screen.findByTitle('Email not verified')).toBeInTheDocument();
  });
});
