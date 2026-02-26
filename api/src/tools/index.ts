/**
 * Tool Registration Index
 * 
 * Registers all Courier MCP tools
 */

import type { ToolContext } from '../types';

// Tool modules (to be created)
import { registerListTools } from './lists';
import { registerSubscriberTools } from './subscribers';
import { registerSequenceTools } from './sequences';
import { registerCampaignTools } from './campaigns';
import { registerTemplateTools } from './templates';
import { registerStatsTools } from './stats';

export function registerAllTools(ctx: ToolContext) {
  registerListTools(ctx);
  registerSubscriberTools(ctx);
  registerSequenceTools(ctx);
  registerCampaignTools(ctx);
  registerTemplateTools(ctx);
  registerStatsTools(ctx);
}

export {
  registerListTools,
  registerSubscriberTools,
  registerSequenceTools,
  registerCampaignTools,
  registerTemplateTools,
  registerStatsTools,
};
