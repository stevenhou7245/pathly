import { NextResponse } from "next/server";
import {
  formatFriendshipDate,
  getFriendshipsForUser,
  getFriendUserIdFromFriendship,
  getUsersBasicWithProfiles,
  splitIncomingOutgoingPending,
} from "@/lib/friends";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type FriendRequestsResponse = {
  success: boolean;
  message?: string;
  incoming?: Array<{
    friendship_id: string;
    from_user: {
      id: string;
      username: string;
      avatar_url: string | null;
    };
    status: string;
    created_at: string | null;
  }>;
  outgoing?: Array<{
    friendship_id: string;
    to_user: {
      id: string;
      username: string;
      avatar_url: string | null;
    };
    status: string;
    created_at: string | null;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendRequestsResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const friendships = await getFriendshipsForUser(sessionUser.id);
    const { incoming, outgoing } = splitIncomingOutgoingPending({
      friendships,
      currentUserId: sessionUser.id,
    });

    const userIds = Array.from(
      new Set(
        [...incoming, ...outgoing].map((friendship) =>
          getFriendUserIdFromFriendship({
            friendship,
            currentUserId: sessionUser.id,
          }),
        ),
      ),
    );

    const usersMap = await getUsersBasicWithProfiles(userIds);

    const incomingPayload = incoming
      .map((friendship) => {
        const fromUserId = friendship.requester_id;
        const user = usersMap.get(fromUserId);
        if (!user) {
          return null;
        }
        return {
          friendship_id: friendship.id,
          from_user: {
            id: user.id,
            username: user.username,
            avatar_url: user.avatar_url,
          },
          status: friendship.status,
          created_at: formatFriendshipDate(friendship.created_at),
        };
      })
      .filter(Boolean) as NonNullable<FriendRequestsResponse["incoming"]>;

    const outgoingPayload = outgoing
      .map((friendship) => {
        const toUserId = friendship.addressee_id;
        const user = usersMap.get(toUserId);
        if (!user) {
          return null;
        }
        return {
          friendship_id: friendship.id,
          to_user: {
            id: user.id,
            username: user.username,
            avatar_url: user.avatar_url,
          },
          status: friendship.status,
          created_at: formatFriendshipDate(friendship.created_at),
        };
      })
      .filter(Boolean) as NonNullable<FriendRequestsResponse["outgoing"]>;

    const payload: FriendRequestsResponse = {
      success: true,
      incoming: incomingPayload,
      outgoing: outgoingPayload,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FriendRequestsResponse = {
      success: false,
      message: "Unable to load friend requests right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
