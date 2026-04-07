import { authApi } from '../../api';

export const authContract = {
  login: authApi.login,
  logout: authApi.logout,
  getMe: authApi.getMe,
  changePassword: authApi.changePassword,
  getTwoFactorStatus: authApi.getTwoFactorStatus,
  setupTwoFactor: authApi.setupTwoFactor,
  enableTwoFactor: authApi.enableTwoFactor,
  disableTwoFactor: authApi.disableTwoFactor,
};
