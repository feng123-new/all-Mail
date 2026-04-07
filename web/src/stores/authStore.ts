import { create } from 'zustand';

export interface Admin {
    id: number;
    username: string;
    email?: string;
    role: 'SUPER_ADMIN' | 'ADMIN';
    mustChangePassword?: boolean;
    twoFactorEnabled?: boolean;
}

interface AuthState {
    admin: Admin | null;
    isAuthenticated: boolean;
    setAuth: (admin: Admin) => void;
    clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
    admin: null,
    isAuthenticated: false,

    setAuth: (admin: Admin) => {
        set({
            admin,
            isAuthenticated: true,
        });
    },

    clearAuth: () => {
        set({
            admin: null,
            isAuthenticated: false,
        });
    },
}));
