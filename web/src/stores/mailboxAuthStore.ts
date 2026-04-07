import { create } from 'zustand';

export interface MailboxUser {
    id: number;
    username: string;
    email?: string | null;
    mustChangePassword?: boolean;
    mailboxIds?: number[];
}

interface MailboxAuthState {
    mailboxUser: MailboxUser | null;
    isAuthenticated: boolean;
    setAuth: (mailboxUser: MailboxUser) => void;
    clearAuth: () => void;
}

export const useMailboxAuthStore = create<MailboxAuthState>()((set) => ({
    mailboxUser: null,
    isAuthenticated: false,

    setAuth: (mailboxUser: MailboxUser) => {
        set({
            mailboxUser,
            isAuthenticated: true,
        });
    },

    clearAuth: () => {
        set({
            mailboxUser: null,
            isAuthenticated: false,
        });
    },
}));
