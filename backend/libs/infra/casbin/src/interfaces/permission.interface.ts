import { AuthActionVerb } from '../constants/authz.constants';

export interface Permission {
  resource: string;
  action: AuthActionVerb | string;
}
