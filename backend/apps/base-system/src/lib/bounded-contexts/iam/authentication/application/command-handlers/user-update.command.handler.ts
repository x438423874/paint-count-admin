import { BadRequestException, Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Status } from '@prisma/client';

import { Password } from '@app/base-system/lib/bounded-contexts/iam/authentication/domain/password.value-object';

import { UserUpdateCommand } from '../../commands/user-update.command';
import { UserReadRepoPortToken, UserWriteRepoPortToken } from '../../constants';
import { User } from '../../domain/user';
import { UserUpdateProperties } from '../../domain/user.read.model';
import { UserReadRepoPort } from '../../ports/user.read.repo-port';
import { UserWriteRepoPort } from '../../ports/user.write.repo-port';

@CommandHandler(UserUpdateCommand)
export class UserUpdateHandler
  implements ICommandHandler<UserUpdateCommand, void>
{
  @Inject(UserWriteRepoPortToken)
  private readonly userWriteRepository: UserWriteRepoPort;
  @Inject(UserReadRepoPortToken)
  private readonly userReadRepoPort: UserReadRepoPort;

  async execute(command: UserUpdateCommand) {
    const existingUser = await this.userReadRepoPort.getUserByUsername(
      command.username,
    );

    if (existingUser && existingUser.id !== command.id) {
      throw new BadRequestException(
        `A user with account ${command.username} already exists.`,
      );
    }

    const userUpdateProperties: UserUpdateProperties = {
      id: command.id,
      username: command.username,
      realName: command.realName?.trim() || null,
      status: Status.ENABLED,
      avatar: command.avatar,
      // 唯一索引列：空串转 null，避免与其它空串用户撞唯一约束（NULL 不参与唯一比较）
      email: command.email?.trim() || null,
      phoneNumber: command.phoneNumber?.trim() || null,
      createdAt: new Date(),
      createdBy: command.uid,
    };

    const user = new User(userUpdateProperties);
    await this.userWriteRepository.update(user);

    if (command.password) {
      const hashedPassword = await Password.hash(command.password);
      await this.userWriteRepository.updatePassword(
        command.id,
        hashedPassword.getValue(),
        command.uid,
      );
    }
  }
}
