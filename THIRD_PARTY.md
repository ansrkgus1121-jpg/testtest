# 오픈소스와 음악 출처

## Demucs
- https://github.com/adefossez/demucs/tree/2883f3db65617d6d178c6ed10d869dc14e44e59b
- MIT; Copyright (c) Meta Platforms, Inc. and affiliates. 원문: DEMUCS-LICENSE.txt
- 해당 커밋을 Python 의존성으로 고정하여 `demucs.api.Separator`로 실제 `htdemucs` 추론을 실행합니다. 소스 수정 없음. CPU, shifts=0, segment=7, overlap=0.25. shifts=0은 랜덤 시프트 반복을 생략해 로컬 테스트 시간을 줄입니다.
- `htdemucs` 다운로드 및 모델 구성은 이 커밋의 공식 로더를 사용하며 인증 토큰이 필요하지 않습니다.

## fogleman/ribbon
- https://github.com/fogleman/ribbon/tree/568057efb726b6f8b8a5c6b067a27f411a77f487
- MIT; Copyright (c) 2017 Michael Fogleman. 원문: RIBBON-LICENSE.txt
- `web/ribbon.js`는 `ribbon/spline.go`의 cubic B-spline과 offset-plane spline, `ribbon/ribbon.go`의 roundedRectangleProfile·createSegmentMesh·triangulateQuad를 JavaScript로 이식했습니다.
- 동일한 B-spline basis를 직접 계산하며, 단백질 좌표/peptide frame을 오디오 제어점/tangent frame으로 바꿨습니다. 추가 입체 표현에서는 연속 tangent frame과 공유 단면의 부드러운 법선을 사용합니다. GPU용 위치·법선 배열을 출력하며 색상은 브라우저 재질로 분리했습니다. 단백질 파서나 Go 실행 파일은 배포·실행하지 않습니다.

## Three.js
- https://github.com/mrdoob/three.js/tree/r170
- 0.170.0, MIT, Copyright © 2010–2024 three.js authors.
- 브라우저 렌더러. `web/vendor/three.module.js`로 로컬 제공, 원문 `web/vendor/THREE-LICENSE.txt`. 실행 중 CDN 요청 없음.

## 테스트 음악
- `samples/ATTRIBUTION.md` 참조. 소프트웨어와 음악의 라이선스는 별개입니다.

기타 Python 의존성은 `requirements-lock.txt`에 고정하며 각 설치 패키지에 포함된 라이선스가 적용됩니다.
