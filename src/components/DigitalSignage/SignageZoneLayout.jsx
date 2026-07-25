// Multi-zone layout renderer for digital signage player.
import React from 'react';
import SignagePlayerCarousel from './SignagePlayerCarousel';

/**
 * @param {{ zones: object[], defaultSlideSeconds: number }} props
 */
const SignageZoneLayout = ({ zones, defaultSlideSeconds = 8, fillMode = 'contain', shuffle = false }) => {
  const list = Array.isArray(zones) ? zones : [];
  if (list.length === 0) return null;

  return (
    <div style={styles.root}>
      {list.map((zone) => {
        const unit = zone.unit === 'pixels' ? 'px' : '%';
        const style = {
          position: 'absolute',
          left: `${zone.x}${unit}`,
          top: `${zone.y}${unit}`,
          width: `${zone.width}${unit}`,
          height: `${zone.height}${unit}`,
          zIndex: zone.zIndex ?? 0,
          backgroundColor: zone.backgroundColor || '#000',
          overflow: 'hidden'
        };
        return (
          <div key={zone.id} style={style} aria-label={zone.name}>
            <SignagePlayerCarousel
              items={zone.items}
              defaultSlideSeconds={defaultSlideSeconds}
              fillMode={fillMode}
              shuffle={shuffle}
            />
          </div>
        );
      })}
    </div>
  );
};

const styles = {
  root: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#000'
  }
};

export default SignageZoneLayout;
