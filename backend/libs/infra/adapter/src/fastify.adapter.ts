import fastifyMultipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { USER_AGENT } from '@lib/constants/rest.constant';

const app: FastifyAdapter = new FastifyAdapter({
  logger: false,
});
export { app as fastifyApp };

// @ts-ignore
app.register(fastifyMultipart, {
  limits: {
    fields: 20, // Max number of non-file fields（批量建单：items JSON + shopId 等）
    // 与各控制器「图片大小不能超过20MB」的业务校验保持一致；
    // 此前全局 6MB 会先于业务校验触发 busboy 截断，导致大图上传收到费解的 500
    fileSize: 1024 * 1024 * 20,
    files: 50, // Max number of file fields（批量 OCR/批量建单一次请求可携带多个文件，此前 5 个会静默丢弃）
  },
});

app.getInstance().addHook('onError', async (request, reply) => {
  const ip = request.ip;
  const userAgent = request.headers[USER_AGENT];
  const url = request.url;

  Logger.log(
    `NotFound: IP:${ip}, UA+${userAgent}, URL=${url}`,
    'fastify.adapter',
  );

  reply.status(500).send({ error: 'error' });
});
