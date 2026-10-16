/**
 * The exception filter's one Sprint 8 change: an unexpected error (anything
 * not thrown as an HttpException) is reported to Sentry with the request's
 * method, path and the signed-in ids; an HttpException never is.
 */
import { Logger, NotFoundException } from '@nestjs/common';

jest.mock('../sentry/sentry', () => ({ reportUnexpectedError: jest.fn() }));

import { reportUnexpectedError } from '../sentry/sentry';
import { HttpExceptionFilter } from './http-exception.filter';

function host(request: Record<string, unknown>) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as never,
    response,
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('reports a non-HttpException with the request context and answers 500 generically', () => {
    const { host: h, response } = host({
      method: 'POST',
      url: '/posts',
      user: { id: 'u1', email: 'secret@example.com' },
      activeOrg: { id: 'org-1' },
    });
    const bug = new TypeError('x is not a function');

    filter.catch(bug, h);

    expect(reportUnexpectedError).toHaveBeenCalledWith(bug, {
      method: 'POST',
      url: '/posts',
      userId: 'u1',
      orgId: 'org-1',
    });
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.any(String),
      statusCode: 500,
    });
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain('not a function');
  });

  it('does not report an HttpException', () => {
    const { host: h, response } = host({ method: 'GET', url: '/posts/x' });

    filter.catch(new NotFoundException('Post not found'), h);

    expect(reportUnexpectedError).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
  });
});
