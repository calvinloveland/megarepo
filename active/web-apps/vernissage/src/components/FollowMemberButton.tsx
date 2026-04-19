'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trackAnalyticsEvent } from '@/src/lib/analytics-client';

type FollowMemberButtonProps = {
  memberHandle: string;
  memberName: string;
  initialFollowing: boolean;
  databaseReady: boolean;
  signInHref?: string;
};

type FollowStatus = {
  tone: 'success' | 'error';
  text: string;
};

export function FollowMemberButton({
  memberHandle,
  memberName,
  initialFollowing,
  databaseReady,
  signInHref
}: FollowMemberButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<FollowStatus | null>(null);

  async function toggleFollow(nextFollowing: boolean) {
    setIsPending(true);
    setStatus(null);

    try {
      const response = await fetch('/api/follows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          memberHandle,
          following: nextFollowing
        })
      });

      if (!response.ok) {
        throw new Error('follow-request-failed');
      }

      const payload = (await response.json()) as { following?: boolean };
      const resolvedFollowing = payload.following === true;
      setIsFollowing(resolvedFollowing);
      if (resolvedFollowing) {
        trackAnalyticsEvent({
          eventType: 'follow_member',
          pageType: 'member',
          path: window.location.pathname + window.location.search,
          targetType: 'member',
          targetSlug: memberHandle
        });
      }
      setStatus({
        tone: 'success',
        text: resolvedFollowing ? `You are now following ${memberName}.` : `You unfollowed ${memberName}.`
      });
    } catch {
      setStatus({
        tone: 'error',
        text: `Vernissage could not update your follow status for ${memberName} right now.`
      });
    } finally {
      setIsPending(false);
    }
  }

  if (!databaseReady) {
    return (
      <section aria-label="Follow member actions">
        <p className="meta-note">Following becomes available once the shared application database is connected.</p>
      </section>
    );
  }

  if (signInHref) {
    return (
      <section aria-label="Follow member actions">
        <div className="button-row">
          <Link href={signInHref} className="enamel-button enamel-button--secondary">
            Sign in to follow
          </Link>
        </div>
        <p className="meta-note">Followed members should be a public part of your Vernissage profile.</p>
      </section>
    );
  }

  return (
    <section aria-label="Follow member actions">
      <div className="button-row">
        <button
          type="button"
          className={`enamel-button ${isFollowing ? 'enamel-button--secondary' : 'enamel-button--primary'}`}
          aria-pressed={isFollowing}
          disabled={isPending}
          onClick={() => toggleFollow(!isFollowing)}
        >
          {isFollowing ? 'Unfollow member' : 'Follow member'}
        </button>
      </div>
      <p className="meta-note">{isFollowing ? 'This member is on your followed list.' : 'Following helps you keep track of other members in the salon.'}</p>
      {status ? <p className={`artwork-quick-actions__status artwork-quick-actions__status--${status.tone}`}>{status.text}</p> : null}
    </section>
  );
}
