import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Server } from 'http';
import * as express from 'express';
import * as helmet from 'helmet';
import { AppModule } from './app.module';
import { createServer, proxy } from 'aws-serverless-express';
import { SecretsManager } from 'aws-sdk';
import { Client } from 'pg';

const port = process.env.PORT || 4000;

let cachedServer: Server;

async function getDatabaseCredentials(secretArn: string) {
  console.log('logo getDatabaseCredentials');
  const secretsManager = new SecretsManager();
  const secretValue = await secretsManager
    .getSecretValue({ SecretId: secretArn })
    .promise();
  if ('SecretString' in secretValue) {
    console.log('logo secretValue', secretValue);
    return JSON.parse(secretValue.SecretString);
  }
  throw new Error('Could not retrieve secret');
}

async function bootstrap() {
  console.log('logo start bootstrap');
  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );
  app.enableCors({
    origin: (req, callback) => callback(null, true),
  });
  app.use(helmet());
  await app.init();
  console.log('logo end bootstrap');
  return createServer(expressApp);
}

export const handler = async (event, context) => {
  if (!cachedServer) {
    console.log('logo Moi event', event);
    console.log('logo Moi context', context);
    console.log('logo before cachedServer = await bootstrap();');
    cachedServer = await bootstrap();
  }
  console.log('logo before const dbSecretArn = process.env.DB_SECRET_ARN;');
  const dbSecretArn = process.env.DB_SECRET_ARN;
  try {
    console.log(
      'logo before const dbCredentials = await getDatabaseCredentials(dbSecretArn);',
    );
    const dbCredentials = await getDatabaseCredentials(dbSecretArn);
    console.log('dbCredentials', dbCredentials);
    const conf = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: dbCredentials.username,
      password: dbCredentials.password,
      // database: process.env.DB_NAME,
      database: dbCredentials.dbname,
    };
    console.log('logo conf', conf);
    const client = new Client(conf);

    await client.connect();
    console.log('logo Successfully connected to the database');

    // Ensure the client is disconnected after request is processed
    context.callbackWaitsForEmptyEventLoop = false;
    context.onEnd(() => {
      client.end();
    });
  } catch (error) {
    console.error('logo Failed to connect to the database:', error);
  }

  return proxy(cachedServer, event, context, 'PROMISE').promise;
};

if (require.main === module) {
  bootstrap()
    .then(() => {
      console.log('logo App is running on %s port', port);
    })
    .catch(() => console.log('logo bootstrap failed'));
}
