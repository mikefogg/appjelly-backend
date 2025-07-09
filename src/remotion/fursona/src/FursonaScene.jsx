import React, { useState, useEffect, useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  delayRender,
  continueRender,
} from "remotion";

export const FursonaScene = ({ imageUrl, audioUrl, text, wordTimingsUrl }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, audioDurationInFrames } = useVideoConfig();

  // Timing constants (using 30fps)
  const AUDIO_DELAY_FRAMES = 30; // 1 second delay before audio starts

  // State for word timings
  const [wordTimings, setWordTimings] = useState(null);

  // Fetch word timings from R2 URL
  useEffect(() => {
    if (wordTimingsUrl) {
      // Delay render until word timings are loaded
      const handle = delayRender();
      
      fetch(wordTimingsUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then((data) => {
          setWordTimings(data);
          continueRender(handle);
        })
        .catch((error) => {
          console.warn("Failed to fetch word timings:", error);
          setWordTimings(null);
          continueRender(handle);
        });
    }
  }, [wordTimingsUrl]);

  // Show image immediately (no delay)
  const imageOpacity = 1;

  // Slow zoom effect throughout the video (starts immediately and continues until the end)
  const zoomScale = interpolate(
    frame,
    [0, durationInFrames - 1], // Go until the very last frame
    [1.0, 1.2], // Very subtle zoom from 100% to 120%
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Slide text up from bottom with spring animation (starts 0.5 seconds after image appears)
  const textAnimation = spring({
    frame: frame - 15, // Start 0.5 seconds after image appears
    fps,
    config: {
      damping: 100,
      stiffness: 200,
      mass: 0.5,
    },
  });

  const textY = interpolate(textAnimation, [0, 1], [100, 0]);
  const textOpacity = interpolate(frame, [15, 45], [0, 1], {
    extrapolateRight: "clamp",
  });

  const textParts = useMemo(() => {
    return text.replaceAll("  ", " ").split(" ");
  }, [text]);



  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Background Image or Black Background */}
      {imageUrl ? (
        <>
          <AbsoluteFill>
            <Img
              src={imageUrl}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: imageOpacity,
                transform: `scale(${zoomScale})`,
                transformOrigin: "center center",
              }}
            />
          </AbsoluteFill>
          {/* Dark gradient overlay for better text readability */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%, transparent 50%, rgba(0,0,0,0.8) 100%)",
            }}
          />
        </>
      ) : (
        /* Plain black background when no image */
        <AbsoluteFill style={{ backgroundColor: "#000" }} />
      )}

      {/* Text Overlay */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "0 60px 120px 60px",
        }}
      >
        <div
          style={{
            transform: `translateY(${textY}px)`,
            opacity: textOpacity,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            padding: "40px",
            borderRadius: "20px",
            backdropFilter: "blur(10px)",
            maxWidth: "90%",
          }}
        >
          <div
            style={{
              color: "white",
              fontSize: "48px",
              fontFamily:
                "SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif",
              fontWeight: "bold",
              textAlign: "center",
              lineHeight: 1.4,
              margin: 0,
              textShadow: "0 2px 10px rgba(0,0,0,0.5)",
            }}
          >
{textParts.map((word, index) => {
              // Use word timings if available, otherwise fall back to fixed timing
              // Word timings are relative to audio start, so add audio delay
              let wordStartFrame =
                (wordTimings?.[index]?.startFrame || index * 6 || 0) +
                AUDIO_DELAY_FRAMES;

              let wordEndFrame = wordStartFrame + 9; // Ensure minimum 9 frame duration

              // Ensure frames are valid (handle edge cases like zero duration)
              if (wordStartFrame === wordEndFrame) {
                wordEndFrame = wordStartFrame + 9; // Minimum 9 frame duration
              }

              // Ensure all timing calculations have valid, monotonic ranges
              const fadeInStart = wordStartFrame;
              const scaleStart = wordStartFrame;
              const scaleEnd = wordEndFrame;
              const highlightStart = wordStartFrame;
              const highlightPeak = wordStartFrame + Math.floor((wordEndFrame - wordStartFrame) / 2);
              const highlightEnd = wordEndFrame;
              
              // Ensure highlight ranges are always different
              const safeHighlightPeak = Math.max(highlightStart + 1, Math.min(highlightPeak, highlightEnd - 1));

              // Word opacity (appears slightly before highlight) - always show word once it starts
              const wordOpacity = frame >= fadeInStart ? 1 : 0;

              // Word scale (subtle pop-in effect) - simpler logic
              const wordScale =
                frame >= scaleStart && frame <= scaleEnd
                  ? interpolate(frame, [scaleStart, scaleEnd], [0.9, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })
                  : frame > scaleEnd
                  ? 1
                  : 0.9;

              // Highlight effect (yellow background that fades) - only during the word's actual timing
              const highlightOpacity =
                frame >= highlightStart && frame <= highlightEnd
                  ? interpolate(
                      frame,
                      [highlightStart, safeHighlightPeak, highlightEnd],
                      [0, 1, 0],
                      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                    )
                  : 0;

              return (
                <span
                  key={index}
                  style={{
                    display: "inline-block",
                    opacity: wordOpacity,
                    transform: `scale(${wordScale})`,
                    marginRight: "12px",
                    position: "relative",
                  }}
                >
                  {/* Highlight background */}
                  <span
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "-4px",
                      right: "-4px",
                      bottom: "0",
                      backgroundColor: "#FFD700",
                      opacity: highlightOpacity,
                      borderRadius: "6px",
                      zIndex: -1,
                    }}
                  />
                  {/* Word text */}
                  <span style={{ position: "relative", zIndex: 1 }}>
                    {word}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>

      {/* Audio */}
      {audioUrl && (
        <Sequence
          from={AUDIO_DELAY_FRAMES}
          durationInFrames={audioDurationInFrames}
        >
          <Audio src={audioUrl} volume={1.0} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
