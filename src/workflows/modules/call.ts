import type { CallVoicemail } from '../../types/openphone';
import type { OpenPhoneID } from '../../types/openphone';
import type { Logger } from '../../utils/logger';
import type { OpenPhoneClient } from '../../utils/openphone-client';
import type { R2Client } from '../../utils/r2-client';

interface StoreRecordingOptions {
  callId: OpenPhoneID<'AC'>;
  createdAt: string;
  recordingUrl?: string | null;
  duration?: number | null;
  contentType?: string | null;
}

export async function storeCallRecording(
  openPhoneClient: OpenPhoneClient,
  r2Client: R2Client,
  logger: Logger,
  options: StoreRecordingOptions
): Promise<string | undefined> {
  if (!options.recordingUrl) {
    logger.info('No recording URL available for call', { callId: options.callId });
    return undefined;
  }

  logger.info('Downloading call recording', { callId: options.callId });
  const audioData = await openPhoneClient.downloadAudioFile(options.recordingUrl);
  const url = await r2Client.uploadRecording(options.callId, audioData, {
    timestamp: options.createdAt,
    duration: options.duration ?? undefined,
    contentType: options.contentType ?? undefined,
  });

  logger.info('Recording stored in R2', { callId: options.callId, url });
  return url;
}

interface StoreVoicemailOptions {
  callId: OpenPhoneID<'AC'>;
  createdAt: string;
  voicemail: CallVoicemail | null;
}

export async function storeCallVoicemail(
  openPhoneClient: OpenPhoneClient,
  r2Client: R2Client,
  logger: Logger,
  options: StoreVoicemailOptions
): Promise<string | undefined> {
  if (!options.voicemail?.url) {
    logger.info('No voicemail URL available for call', { callId: options.callId });
    return undefined;
  }

  logger.info('Downloading voicemail recording', { callId: options.callId });
  const audioData = await openPhoneClient.downloadAudioFile(options.voicemail.url);
  const url = await r2Client.uploadVoicemail(options.callId, audioData, {
    timestamp: options.createdAt,
    duration: options.voicemail.duration ?? undefined,
    transcription: options.voicemail.transcription ?? undefined,
  });

  logger.info('Voicemail stored in R2', { callId: options.callId, url });
  return url;
}
