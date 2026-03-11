# Supabase 쿼리 및 RPC 인터페이스

화면별로 자주 사용하는 Supabase 클라이언트 쿼리와 RPC 호출 규약입니다. 실제 구현 시 `supabase` 인스턴스와 `auth.getUser()`/`auth.uid()` 결과를 사용합니다.

---

## 공통

- **현재 유저 ID**: `(await supabase.auth.getUser()).data.user?.id`
- **프로필 조회 (단일)**  
  - 현재 유저: `supabase.from('profiles').select('*').eq('id', userId).single()`  
  - 특정 유저: `supabase.from('profiles').select('id,nickname,mbti,gender,age,avatar_url,token_balance').eq('id', targetId).single()`

---

## 로그인 / 회원가입

- **가입**: `supabase.auth.signUp({ email, password })`  
  - 성공 후 `profiles`에 1건 INSERT (닉네임, MBTI, 성별, 나이, 아바타 URL, token_balance 등).  
  - `id = user.id`로 insert. (앱에서 직접 `supabase.from('profiles').insert({ id: user.id, nickname, mbti, ... })` 호출.)
- **로그인**: `supabase.auth.signInWithPassword({ email, password })`
- **로그아웃**: `supabase.auth.signOut()`

---

## 메인 페이지

### 매칭 목록 (나와 매칭됐던 사람, 친구 제외)

- **의도**: `matches`에서 현재 유저가 참여한 이력 중, 이미 친구가 아닌 상대의 프로필 목록. 친구 요청 상태(보낸 요청 pending/rejected)도 함께 보여줘야 함.
- **쿼리 1** – 내 매칭 이력 (상대 id 수집용):  
  `supabase.from('matches').select('id,user_a_id,user_b_id').or('user_a_id.eq.' + uid + ',user_b_id.eq.' + uid).order('created_at', { ascending: false })`
- **쿼리 2** – 내 친구 쌍:  
  `supabase.from('friends').select('user_a_id,user_b_id').or('user_a_id.eq.' + uid + ',user_b_id.eq.' + uid)`  
  → 친구인 상대 id 집합을 만든 뒤, 매칭 목록에서 해당 id 제외.
- **쿼리 3** – 상대 프로필 + 보낸 친구 요청 상태:  
  - 매칭 목록에 남은 상대 id마다 `profiles` select.  
  - `friend_requests`에서 `from_user_id = uid AND to_user_id = 상대id` 로 1건 select → status(pending/accepted/rejected)로 버튼 상태 결정.

또는 **뷰/함수**로 “매칭된 상대 중 비친구 + 요청 상태”를 한 번에 반환하는 RPC를 두고, 프론트는 해당 RPC만 호출하도록 할 수 있음 (예: `get_matching_list()`).

### 친구 목록

- **쿼리**:  
  `supabase.from('friends').select('id,user_a_id,user_b_id,created_at').or('user_a_id.eq.' + uid + ',user_b_id.eq.' + uid)`  
  → 각 row에서 상대 id = `user_a_id === uid ? user_b_id : user_a_id`.  
  상대 id 목록으로 `profiles`를 in 쿼리:  
  `supabase.from('profiles').select('id,nickname,mbti,avatar_url').in('id', peerIds)`

### 친구 요청 보내기

- **RPC**: `supabase.rpc('request_friend', { p_to_user_id: targetUserId })`  
- **반환**: `{ ok: boolean, error?: string, required?: number }`  
  - `ok: true` → 성공.  
  - `ok: false`, `error: 'insufficient_tokens'`, `required: 5` → 토큰 부족 등.

### 받은 친구 요청 목록 (수락/거절용)

- **쿼리**:  
  `supabase.from('friend_requests').select('id,from_user_id,to_user_id,status,created_at').eq('to_user_id', uid).eq('status', 'pending')`  
  → `from_user_id`로 `profiles` 조회해 요청자 닉네임/아바타 표시.

### 친구 요청 수락/거절

- **RPC**: `supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: true | false })`  
- **반환**: `{ ok: boolean, error?: string, accepted?: boolean }`

---

## 매칭 페이지

### 매칭 조건 저장 (대기 등록)

- **동작**: `match_queue`에 1건 INSERT (한 유저당 1 row만 유지하려면 기존 row 삭제 후 insert 또는 upsert).  
- **쿼리**:  
  `supabase.from('match_queue').upsert({ user_id: uid, gender_preference, age_min, age_max, mbti_preference }, { onConflict: 'user_id' })`  
  (또는 먼저 delete from match_queue where user_id = uid 한 뒤 insert.)

### 매칭 대기 취소

- **쿼리**: `supabase.from('match_queue').delete().eq('user_id', uid)`

### 현재 대기/매칭 상태 확인

- **대기 중**: `supabase.from('match_queue').select('id').eq('user_id', uid).maybeSingle()`
- **진행 중인 매칭**:  
  `supabase.from('matches').select('id,user_a_id,user_b_id,expires_at,status').or('user_a_id.eq.' + uid + ',user_b_id.eq.' + uid).in('status', ['waiting','active']).order('created_at', { ascending: false }).limit(1).maybeSingle()`

(실제 매칭 생성은 백엔드/Edge Function 또는 DB 함수에서 `match_queue`를 조회해 조건에 맞는 쌍을 만들고 `matches`에 insert + 큐에서 삭제.)

### 매칭 채팅 메시지 목록

- **쿼리**:  
  `supabase.from('match_messages').select('id,sender_id,message,created_at').eq('match_id', matchId).order('created_at', { ascending: true })`

### 매칭 채팅 메시지 전송

- **쿼리**:  
  `supabase.from('match_messages').insert({ match_id: matchId, sender_id: uid, message: text })`

---

## 친구 1:1 채팅

### 친구 방(room) id 조회

- **쿼리**:  
  `supabase.from('friends').select('id').or('and(user_a_id.eq.' + uid + ',user_b_id.eq.' + friendId + '),and(user_a_id.eq.' + friendId + ',user_b_id.eq.' + uid + ')').maybeSingle()`  
  → 정규화된 (user_a_id, user_b_id) 저장이면, `user_a_id = min(uid, friendId)` AND `user_b_id = max(uid, friendId)` 로 한 건 조회.

### 친구 채팅 메시지 목록

- **쿼리**:  
  `supabase.from('friend_messages').select('id,sender_id,message,created_at').eq('room_id', friendRoomId).order('created_at', { ascending: true })`

### 친구 채팅 메시지 전송

- **쿼리**:  
  `supabase.from('friend_messages').insert({ room_id: friendRoomId, sender_id: uid, message: text })`

---

## 마이 페이지

### 프로필 수정 (닉네임, 프로필 사진)

- **쿼리**:  
  `supabase.from('profiles').update({ nickname, avatar_url }).eq('id', uid)`  
  (닉네임 변경 시 닉네임 중복 체크: `supabase.from('profiles').select('id').eq('nickname', nickname).maybeSingle()` → 존재하면 다른 유저가 사용 중.)

---

## RPC 시그니처 요약

| RPC 이름 | 파라미터 | 반환 (jsonb) |
|----------|----------|----------------|
| `request_friend` | `p_to_user_id` (uuid) | `{ ok, error?, required? }` |
| `respond_friend_request` | `p_request_id` (uuid), `p_accept` (boolean) | `{ ok, error?, accepted? }` |

에러 예: `not_authenticated`, `cannot_request_self`, `insufficient_tokens`, `request_already_pending`, `request_previously_rejected`, `already_friends`, `profile_not_found`, `request_not_found_or_not_receiver`, `request_already_responded`.
