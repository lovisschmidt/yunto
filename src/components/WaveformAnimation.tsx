import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { PipelineStatus } from "../services/pipeline.js";

interface Props {
  status: PipelineStatus;
}

const BAR_COUNT = 5;
const BAR_HEIGHT = 60;
const BAR_WIDTH = 6;
const BAR_GAP = 8;
const MIN_SCALE = 0.3;

export function WaveformAnimation({ status }: Props) {
  const animations = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(MIN_SCALE)),
  ).current;

  const loopRefs = useRef<Animated.CompositeAnimation[]>([]);

  const isActive = status === "recording" || status === "speaking";
  const isPulsing = status === "processing" || status === "thinking";

  useEffect(() => {
    loopRefs.current.forEach((a) => a.stop());
    loopRefs.current = [];

    if (isActive) {
      animations.forEach((anim, i) => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 0.3 + Math.random() * 0.7,
              duration: 300 + i * 80,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: MIN_SCALE,
              duration: 300 + i * 80,
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
        loopRefs.current.push(loop);
      });
    } else if (isPulsing) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(animations[2]!, {
            toValue: 0.6,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(animations[2]!, {
            toValue: MIN_SCALE,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      loopRefs.current.push(pulse);
      animations
        .filter((_, i) => i !== 2)
        .forEach((anim) => {
          Animated.spring(anim, {
            toValue: MIN_SCALE,
            useNativeDriver: true,
          }).start();
        });
    } else {
      animations.forEach((anim) => {
        Animated.spring(anim, {
          toValue: MIN_SCALE,
          useNativeDriver: true,
        }).start();
      });
    }

    return () => {
      loopRefs.current.forEach((a) => a.stop());
    };
  }, [isActive, isPulsing, animations]);

  return (
    <View style={styles.container}>
      {animations.map((anim, i) => (
        <Animated.View key={i} style={[styles.bar, { transform: [{ scaleY: anim }] }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: BAR_HEIGHT,
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    borderRadius: BAR_WIDTH / 2,
    backgroundColor: "#6366f1",
  },
});
