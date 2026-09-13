// AWS Builder Center's 21 badges are a fixed, publicly documented catalog.
// Names/descriptions are verified verbatim against the real site as of
// 2026-09-13: 12 from `GET api.builder.aws.com/rms/badges` (earned badges),
// 8 more from a second badge-progress endpoint (in-progress badges, with
// real threshold/progressCount), and "90-Day Comment Streak" by the user
// checking builder.aws.com directly (it wasn't in either API payload).
// `target`/`unit` drive the progress bar on the public page and the
// progress input in the admin form. `icon` files are the real AWS badge SVGs
// (mirrored into public/badges/ — see docs/PRD.md for provenance); the 9
// icons for not-yet-earned badges were found by following the exact naming
// pattern AWS uses for the 12 confirmed ones and verifying each file exists.
export const BADGE_CATALOG = [
  { name: 'Knowledge Seeker', criteria: 'Read 10 different articles.', target: 10, unit: 'articles read', icon: 'ABC_DigitalBadge_GettingStarted_KnowledgeSeeker_Complete.svg' },
  { name: 'Hello, World!', criteria: 'Complete the About section in your profile to introduce yourself in Builder Center.', icon: 'ABC_DigitalBadge_GettingStarted_HelloWorld_Complete.svg' },
  { name: 'Photo Finisher', criteria: 'Upload a photo to your profile.', icon: 'ABC_DigitalBadge_GettingStarted_PhotoFinisher_Complete.svg' },
  { name: 'Discussion Debut', criteria: 'Join the conversation by commenting on content.', icon: 'ABC_DigitalBadge_GettingStarted_DiscussionDebut_Complete.svg' },
  { name: 'First Wish', criteria: 'Publish your first wish in AWS Wishlist.', icon: 'ABC_DigitalBadge_GettingStarted_FirstWish_Complete.svg' },
  { name: 'First Article', criteria: 'Publish your first article.', icon: 'ABC_DigitalBadge_GettingStarted_FirstArticle_Complete.svg' },
  { name: '7-Day Visit Streak', criteria: 'Visit Builder Center daily for seven consecutive days while signed in.', target: 7, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_7DaySignInStreak_Complete.svg' },
  { name: '7-Day Like Streak', criteria: 'Like content daily for seven consecutive days.', target: 7, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_7DayLikeStreak_Complete.svg' },
  { name: '7-Day Comment Streak', criteria: 'Comment daily for seven consecutive days.', target: 7, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_7DayCommentStreak_Complete.svg' },
  { name: '4-Week Wish Vote Streak', criteria: 'Vote on wishes weekly for four consecutive weeks.', target: 4, unit: 'weeks', icon: 'ABC_DigitalBadge_HotStreaks_4WeekWishVoteStreak_Complete.svg' },
  { name: '4-Week Article Publishing Streak', criteria: 'Publish an article weekly for four consecutive weeks.', target: 4, unit: 'weeks', icon: 'ABC_DigitalBadge_HotStreaks_4WeekArticlePublishingStreak_Complete.svg' },
  { name: '30-Day Visit Streak', criteria: 'Visit Builder Center daily for 30 consecutive days while signed in.', target: 30, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_30DaySignInStreak_Complete.svg' },
  { name: '30-Day Like Streak', criteria: 'Like content daily for 30 consecutive days.', target: 30, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_30DayLikeStreak_Complete.svg' },
  { name: '30-Day Comment Streak', criteria: 'Comment daily for 30 consecutive days.', target: 30, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_30DayCommentStreak_Complete.svg' },
  { name: 'Conversation Starter', criteria: 'Get a reply on 10 of your comments.', target: 10, unit: 'comments', icon: 'ABC_DigitalBadge_EnsuringQualityContent_ConversationStarter_Complete.svg' },
  { name: 'Meaningful Contributor', criteria: 'Get 10 likes on five of your comments.', target: 5, unit: 'comments', icon: 'ABC_DigitalBadge_EnsuringQualityContent_MeaningfulContributor_Complete.svg' },
  { name: 'Valued Creator', criteria: 'Get 10 likes on five of your articles.', target: 5, unit: 'articles', icon: 'ABC_DigitalBadge_EnsuringQualityContent_ValuedCreator_Complete.svg' },
  { name: 'Idea Influencer', criteria: 'Get 10 votes on your wishes.', target: 10, unit: 'votes', icon: 'ABC_DigitalBadge_EnsuringQualityContent_IdeaInfluencer_Complete.svg' },
  { name: '90-Day Visit Streak', criteria: 'Visit Builder Center daily for 90 consecutive days while signed in.', target: 90, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_90DaySignInStreak_Complete.svg' },
  { name: '90-Day Like Streak', criteria: 'Like content daily for 90 consecutive days.', target: 90, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_90DayLikeStreak_Complete.svg' },
  { name: '90-Day Comment Streak', criteria: 'Comment daily for 90 consecutive days.', target: 90, unit: 'days', icon: 'ABC_DigitalBadge_HotStreaks_90DayCommentStreak_Complete.svg' },
];
