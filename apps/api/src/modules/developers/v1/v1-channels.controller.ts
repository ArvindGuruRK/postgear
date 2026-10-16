/**
 * `GET /v1/channels` — the targets a post may be sent to.
 */
import { Controller, Get } from '@nestjs/common';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { ChannelsService } from '../../channels/channels.service';
import { ApiKeyAuth } from '../auth/api-key-auth.decorator';
import { toPublicChannel } from './public-channels.mapper';

@Controller('v1/channels')
@ApiKeyAuth()
export class V1ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    const channels = await this.channels.list(org.id);

    return { channels: channels.map(toPublicChannel) };
  }
}
