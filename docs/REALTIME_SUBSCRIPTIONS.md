# Realtime 구독 전략

Supabase Realtime을 사용할 때 프론트엔드에서 구독할 채널/테이블과 필터 전략을 정리한 문서입니다.

## 활성화된 테이블

다음 테이블은 `supabase_realtime` publication에 포함되어 있어 변경 시 이벤트가 브로드캐스트됩니다.

| 테이블 | 용도 |
|--------|------|
| `profiles` | 현재 유저 프로필(닉네임, 아바타, 토큰) 변경 시 헤더/마이페이지 반영 |
| `matches` | 매칭 대기/연결/종료/취소 상태 전환 |
| `match_queue` | 본인이 대기 중일 때 큐 삭제(매칭됨/취소) 감지 |
| `friend_requests` | 친구 요청 수신, 수락/거절 상태 변경 |
| `friends` | 친구 관계 추가 시 친구 목록 갱신 |
| `match_messages` | 매칭 채팅 메시지 수신 |
| `friend_messages` | 1:1 친구 채팅 메시지 수신 |

## 구독 단위 및 필터 전략

### 1. `profiles`

- **목적**: 로그인한 유저 자신의 프로필 변경 시 UI 갱신(닉네임, 아바타, 토큰 잔액).
- **구독 방식**: `channel('profiles')` + 필터 `filter('id', 'eq', currentUserId)`.
- **이벤트**: `UPDATE`만 구독해도 됨 (INSERT는 가입 시 1회).

### 2. `matches`

- **목적**: 매칭 대기 → 연결, 연결 → 종료/취소 등 상태 변경 실시간 반영.
- **구독 방식**: `channel('matches')` + 필터 `or('user_a_id.eq.uid,user_b_id.eq.uid)` (Supabase는 `or` 필터 지원).
- **이벤트**: `INSERT`, `UPDATE` 구독. 새 매칭 생성, status 변경(active, ended, cancelled) 감지.

### 3. `match_queue`

- **목적**: "매칭하기" 후 대기 중일 때, 본인 row가 삭제되면 매칭됨 또는 취소로 처리.
- **구독 방식**: `channel('match_queue')` + 필터 `filter('user_id', 'eq', currentUserId)`.
- **이벤트**: `DELETE` 감지 시 → 매칭 성공이면 `matches`에서 status=active인 새 row 확인; 없으면 취소로 처리.

### 4. `friend_requests`

- **목적**: 받은 친구 요청 목록 갱신, 보낸 요청의 수락/거절 상태 반영.
- **구독 방식**: `channel('friend_requests')` + 필터 `or('from_user_id.eq.uid,to_user_id.eq.uid)`.
- **이벤트**: `INSERT` (새 요청 수신), `UPDATE` (status → accepted/rejected).

### 5. `friends`

- **목적**: 친구 목록 실시간 갱신(상대가 수락 시).
- **구독 방식**: `channel('friends')` + 필터 `or('user_a_id.eq.uid,user_b_id.eq.uid)`.
- **이벤트**: `INSERT` 구독.

### 6. `match_messages`

- **목적**: 현재 열려 있는 매칭 채팅방의 메시지만 실시간 수신.
- **구독 방식**: 매칭 채팅 UI를 열 때만 구독. `channel('match_messages')` + 필터 `filter('match_id', 'eq', currentMatchId)`.
- **이벤트**: `INSERT` 구독. 페이지/탭 전환 시 해당 채널 unsubscribe.

### 7. `friend_messages`

- **목적**: 현재 열려 있는 친구 1:1 채팅방의 메시지만 실시간 수신.
- **구독 방식**: 친구 채팅 UI를 열 때만 구독. `channel('friend_messages')` + 필터 `filter('room_id', 'eq', currentFriendRoomId)`.
- **이벤트**: `INSERT` 구독. 채팅창 닫을 때 해당 채널 unsubscribe.

## 클라이언트 구현 요약

```text
공통:
- 로그인 성공 후 현재 유저 ID를 저장.
- Supabase Realtime channel은 컴포넌트 마운트 시 subscribe, 언마운트 시 unsubscribe.

전역(앱 레벨) 구독:
- profiles (id = me)
- matches (user_a_id = me OR user_b_id = me)
- match_queue (user_id = me) — 매칭 페이지에 있을 때만 구독해도 됨
- friend_requests (from/to = me)
- friends (user_a_id = me OR user_b_id = me)

페이지/모달 단위 구독:
- match_messages (match_id = 현재 매칭 채팅방 id)
- friend_messages (room_id = 현재 친구 채팅방 id)
```

## 주의사항

- RLS가 켜져 있으므로, 클라이언트는 자신이 읽을 수 있는 row의 변경만 Realtime으로 수신합니다.
- 메시지 테이블은 채팅방을 열 때만 구독하면 트래픽과 성능에 유리합니다.
