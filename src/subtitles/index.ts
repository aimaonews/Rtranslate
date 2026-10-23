// 字幕翻译内容脚本入口：按站点分发到 YouTube / 会议平台
import { startYouTube } from './youtube'
import { startMeetings } from './meetings'

const host = location.hostname

const w = window as unknown as { __TV_SUBTITLES_INJECTED__?: boolean }
if (!w.__TV_SUBTITLES_INJECTED__) {
  w.__TV_SUBTITLES_INJECTED__ = true
  if (host === 'www.youtube.com') {
    startYouTube()
  } else if (
    host === 'meet.google.com' ||
    host === 'teams.microsoft.com' ||
    host === 'teams.live.com' ||
    host === 'zoom.us' ||
    host.endsWith('.zoom.us')
  ) {
    startMeetings()
  }
}

export {}
