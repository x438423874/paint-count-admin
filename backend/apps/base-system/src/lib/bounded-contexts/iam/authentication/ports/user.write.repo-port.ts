import { User } from '../domain/user';

export interface UserWriteRepoPort {
  deleteUserRoleByRoleId(roleId: string): Promise<void>;

  deleteUserRoleByDomain(domain: string): Promise<void>;

  deleteUserRoleByUserId(userId: string): Promise<void>;

  deleteById(id: string): Promise<void>;

  save(role: User): Promise<void>;

  update(role: User): Promise<void>;

  /** 更新登录密码（传入 bcrypt 哈希后的新密码），并记录操作人。 */
  updatePassword(userId: string, hashedPassword: string, updatedBy: string): Promise<void>;
}
