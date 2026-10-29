/**
 * The exception filter's one Sprint 8 change: an unexpected error (anything
 * not thrown as an HttpException) is reported to Sentry with the request's
 * method, path and the signed-in ids; an HttpException never is.
 */
import { HttpException, Logger, NotFoundException } from '@nestjs/common';

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

  it('passes a snake_case code through, and drops anything else in that field', () => {
    const coded = host({ method: 'PATCH', url: '/users/me/appearance' });
    filter.catch(
      new HttpException({ message: 'Needs a plan', code: 'premium_theme_requires_plan' }, 402),
      coded.host,
    );
    expect(coded.response.json).toHaveBeenCalledWith({
      error: 'Needs a plan',
      statusCode: 402,
      code: 'premium_theme_requires_plan',
    });

    const freeText = host({ method: 'PATCH', url: '/x' });
    filter.catch(new HttpException({ message: 'No', code: 'Column "email" collided' }, 409), freeText.host);
    expect(freeText.response.json).toHaveBeenCalledWith({ error: 'No', statusCode: 409 });
  });

  it('passes whole-number details of a coded refusal, and nothing that could be text', () => {
    const conflict = host({ method: 'PATCH', url: '/automations/x' });
    filter.catch(
      new HttpException(
        {
          message: 'Changed elsewhere',
          code: 'automation_conflict',
          details: { currentRevision: 7, note: 'leak', ratio: 0.5, 'bad key': 1 },
        },
        409,
      ),
      conflict.host,
    );
    expect(conflict.response.json).toHaveBeenCalledWith({
      error: 'Changed elsewhere',
      statusCode: 409,
      code: 'automation_conflict',
      details: { currentRevision: 7 },
    });

    const uncoded = host({ method: 'PATCH', url: '/x' });
    filter.catch(
      new HttpException({ message: 'No', details: { currentRevision: 7 } }, 409),
      uncoded.host,
    );
    expect(uncoded.response.json).toHaveBeenCalledWith({ error: 'No', statusCode: 409 });
  });

  it('does not report an HttpException', () => {
    const { host: h, response } = host({ method: 'GET', url: '/posts/x' });

    filter.catch(new NotFoundException('Post not found'), h);

    expect(reportUnexpectedError).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
  });
});
