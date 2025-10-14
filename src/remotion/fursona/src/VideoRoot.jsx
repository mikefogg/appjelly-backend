import React from "react";
import { Composition } from "remotion";
import { FursonaScene } from "./FursonaScene";

// Default props for development
const defaultProps = {
  imageUrl: "https://via.placeholder.com/1080x1920",
  audioUrl: null,
  text: "Today I discovered that the mailman is actually a treat dispenser in disguise!",
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="FursonaVideo"
        component={FursonaScene}
        calculateMetadata={({ props }) => {
          // Use duration from props if available, otherwise default to 10 seconds
          const durationInSeconds = props.durationInSeconds || 10;
          return {
            durationInFrames: durationInSeconds * 30,
          };
        }}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
    </>
  );
};
