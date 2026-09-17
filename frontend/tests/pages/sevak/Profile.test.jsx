import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import Profile from '../../../src/pages/sevak/Profile.jsx';

let params = { id: 'sevak-1' };
const navigate = vi.fn();

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
  getApiBaseURL: () => 'http://localhost:8000',
}));

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'sevak-1', role: 'SEVAK' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => params,
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/profile', state: null }),
  };
});

describe('Profile', () => {
  beforeEach(() => {
    params = { id: 'sevak-1' };
    apiGet.mockImplementation((url) => {
      if (url === '/api/sevaks/sevak-1') {
        return Promise.resolve({
          data: {
            id: 'sevak-1',
            sevak_id: 10006,
            first_name: 'Teja',
            last_name: 'Krishna',
            email: 'sevak@example.com',
            email_verified: true,
            phone: '9999999999',
            address: 'Hyderabad',
            department_id: 'dept-1',
            default_week_off: 'Sunday',
            role: 'SEVAK',
            id_proof_path: null,
            pan_card_path: null,
            passbook_path: null,
          },
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

  it('shows a verified email indicator for verified accounts', async () => {
    render(<Profile />);

    expect(await screen.findByText(/Personal Details/i)).toBeInTheDocument();
    expect(screen.getByTitle('Email verified')).toBeInTheDocument();
    expect(screen.getByText('sevak@example.com')).toBeInTheDocument();
  });
});
