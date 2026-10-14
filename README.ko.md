<h1 align="center" className="text-center" style="text-align: center;">
  Architecture Companion
</h1>

<p align="center" className="text-center" style="text-align: center;">
  대화형 다이어그램으로 에이전트와 함께 코드를 설계하고 리뷰하세요. Claude Code, Codex, OpenCode — 어떤 코딩 하네스에서든 동작합니다.
</p>

<p align="center" className="text-center" style="text-align: center;">
  <a href="README.md">English</a> · <strong>한국어</strong>
</p>

<br><br>

## 빠른 시작

### 1. 스킬을 설치합니다.

[skills.sh](https://skills.sh/) CLI로 설치합니다. 스킬 실행에는 Node.js 22.18.0 이상이 필요합니다.

```sh
npx skills add choegyumin/architecture-companion
```

### 2. 다이어그램을 생성하고, 댓글로 질문하고, 작업을 지시하세요.

다이어그램은 코드를 근거로 생성되며, 그림으로 코드를 이해할 수 있습니다. 또한, 다이어그램에 바로 피드백을 남겨 에이전트에게 후속 요청을 전달할 수 있습니다.

```text
❯ /architecture-companion 장바구니 페이지 컴포넌트의 렌더 트리를 그려줘.

● 정적 분석을 통해 CartPage를 루트로 하는 컴포넌트 구조를 다이어그램으로 만들었습니다.

  컴패니언 URL: http://127.0.0.1:4317
  아티팩트 이름: Code Design > Cart Page Component Structure

❯ 수량 상태를 누가 소유하고, 변경이 화면 갱신까지 이어지는 과정을 단계별로 보여줘.

● Spotlight를 실행해서 브라우저에 Walkthrough를 전달했습니다.

  수량 변경이 화면에 반영되는 왕복 흐름을 4단계로 담았습니다.
  화면에 현재 단계의 요소가 강조와 설명이 함께 표시됩니다. 방향키(← →)로 단계를 이동해 보세요.

  만약 브라우저에 아티팩트를 열어두지 않았다면 다음 URL로 접속하세요:
  http://127.0.0.1:4317/artifacts/.architecture-companion/artifacts/cart-page-component-structure.archcomp.json?walkthrough=…

❯ 댓글 확인하고 답변해줘.

● 아티팩트에서 댓글 2건을 확인했습니다.

  1. CartItemList: "수량 변경 핸들러가 몇 단계를 거쳐 전달되지?
     onQuantityChange가 CartPage → CartItemList → CartItem로 2단계 전달됩니다 (CartPage.tsx:24).
  2. OrderSummary: "쿠폰 할인이 결제 총액을 대상으로 계산되나?"
     쿠폰 할인은 배송비를 제외한 상품 금액에만 적용되며, 배송비는 '배송비 무료 쿠폰'으로 별도 처리됩니다 (domain/cart.tsx:15, components/OrderSummary.tsx:25).

❯ 새 댓글 확인하고 작업 시작해.

● 새 댓글을 확인했습니다.

  1. CartPage: "items.length === 0 분기의 인라인 마크업을 Empty 컴포넌트로 교체해."
  2. CartItemList: "수량 변경은 계속 CartPage가 담당하고, CartItem은 CartPage에서 조립해 children으로 넘겨줘. CartItemList는 레이아웃만 담당해야 해."
  3. OrderSummary: "할인 내역에서 배송비 면제를 상품 할인과 별도 항목으로 분리해 표기해줘."

  작업을 시작합니다.
```

### 3. 다음 작업에서도 이어서 사용하기

다이어그램은 JSON 아티팩트 형태로 설명하는 소스 코드 옆이나 `.architecture-companion/artifacts/`에 저장됩니다. 저장된 아티팩트를 다시 열어 검토하거나, 소스가 바뀐 뒤 같은 목적과 기준으로 갱신하도록 요청할 수 있습니다.

```text
❯ /architecture-companion 아티팩트를 현재 소스 코드 기준으로 갱신해줘.
```

아티팩트 수집 대상은 `.architecture-companion/config.json`의 `include`로 지정할 수 있습니다. `include`는 glob을 지원하며, 기본값은 `["**/*.archcomp.json"]`입니다. 아티팩트 파일의 배치 규칙 등 에이전트가 따를 자연어 지침은 `instructions`에 기록하세요.

커밋을 원하지 않는다면 `.gitignore`에 `.architecture-companion/`을 추가하세요. 기본적으로 `.gitignore`에 지정된 경로는 수집 대상에서 제외되지만, `.architecture-companion/artifacts/` 아래 JSON 파일은 항상 탐색합니다. Git으로 추적하지 않고도 `.architecture-companion/artifacts/`에 아티팩트를 유지할 수 있습니다.

<br><br>

## Architecture Companion이 할 수 있는 것

설계·검토·피드백 모두 하나의 다이어그램 안에서 이루어집니다.

| 항목               | 설명                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| 다이어그램 생성    | 플로우 차트, 시퀀스 다이어그램 등 질문에 맞는 형태로 자유롭게 생성                       |
| 소스 근거 확인     | 그림의 요소와 관계를 관련 소스로 거슬러 확인                                             |
| 피드백과 후속 작업 | 요소·관계·캔버스 빈 영역에 코멘트를 남기고, 그 코멘트를 근거로 에이전트에 설명·변경 요청 |

질문에 특화된 다이어그램도 만들 수 있습니다. 정적 분석 기반 다이어그램은 코드에 변경이 없다면 항상 동일한 그림을 그립니다 (결정적입니다).

| 항목                       | 설명                                                                                                                                                          | 정적 분석 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 모듈 의존성 그래프 (JS/TS) | 폴더를 계층으로 묶어, 파일 간 의존 관계와 외부 패키지 참조를 보여 줍니다. Focus 기능으로 관심 있는 파일·폴더·의존 경로의 세부 의존 관계를 확인할 수 있습니다. | 예        |
| 컴포넌트 렌더 트리 (React) | 컴포넌트가 어떤 컴포넌트가 렌더링하는지 보여 줍니다. 분기·조건을 전환하며 렌더링되는 컴포넌트가 어떻게 달라지는지 확인할 수 있습니다.                         | 예        |

<br><br>

## 왜 Architecture Companion인가?

코드 생성은 AI가 담당하지만, 그 책임은 여전히 사람에게 남습니다. 구현이 요구사항을 충족하는지, 예외 상황의 처리가 빠져 있지 않은지, 역할·책임·소유권이 제자리에 있는지 이해하고 판단해야 합니다.

코드의 이해를 돕는 가장 좋은 도구 중 하나는 다이어그램입니다. 그러나 다이어그램 자체는 에이전트나 기존 도구로도 얻을 수 있습니다. Architecture Companion이 채우려는 간극은 네 가지입니다.

- **에이전트가 그리는 그림은 해석 결과입니다.** 코딩 에이전트에 다이어그램을 요청하면 모델이 코드를 읽고 떠올린 구조를 그립니다. 같은 코드로 다시 요청하면 다른 그림이 나올 수 있고, 그려진 관계가 어느 소스에서 왔는지 확인할 길이 없습니다. Architecture Companion은 정적 분석 결과를 근거로 다이어그램을 생성합니다.
- **다이어그램 단위 추상화는 맥락을 끊습니다.** C4 모델처럼 다이어그램마다 한 계층 레벨씩 보여주는 방식에서는, 상위 레벨을 표현하면 내부 요소 사이의 관계를 볼 수 없고, 하위 레벨만 표현하면 상위 형제 요소와의 관계를 볼 수 없습니다. Architecture Companion은 다이어그램을 추상화하는 대신, 하나의 다이어그램 안에서 상호작용으로 표현할 정보를 바꿔 인지부하를 줄입니다.
- **대부분의 다이어그램은 일회용입니다.** 다이어그램은 이해를 돕는 그림이며, 지금도 적극적으로 쓰입니다. 그러나 이해하고 나면 그 역할이 끝납니다. Architecture Companion은 Annotation, Spotlight 등의 기능으로 그림에 의견을 남기고 작업으로 이어 가서, 이해를 넘어 AI와의 협업을 지원합니다.
- **범용 도구는 의존 그래프에 머뭅니다.** 코드를 분석해 그리는 도구도 대부분 파일·모듈의 의존과 참조 관계까지만 표현합니다. Architecture Companion은 컴포넌트 렌더 트리처럼 질문의 종류에 맞는 분석과 시각적 표현을 제공합니다.

Architecture Companion의 설계 철학과 배경은 [philosophy.md](docs/philosophy.md)에 더 자세히 담아 두었습니다.

<br><br>

## 더 알아보기

- [Architecture Companion — SKILL.md](skills/architecture-companion/SKILL.md)
- [아키텍처와 의존성 경계](ARCHITECTURE.md)
- [기여 지침](CONTRIBUTING.md)
- [용어 사전](GLOSSARY.md)
- [철학](docs/philosophy.md)
