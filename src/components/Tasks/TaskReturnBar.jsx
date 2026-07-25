import React from 'react';

import { useSearchParams } from 'react-router-dom';

import { TavariStyles } from '../../utils/TavariStyles';

import { buildTaskKioskReturnUrl } from '../../helpers/taskManagerKioskSession';



const TaskReturnBar = () => {

  const [searchParams] = useSearchParams();

  const taskReturn = searchParams.get('taskReturn');



  if (!taskReturn) return null;



  const handleReturn = () => {

    window.location.href = buildTaskKioskReturnUrl(taskReturn);

  };



  return (

    <div style={styles.bar}>

      <div style={styles.text}>

        <strong>Task in progress.</strong>

        {' '}

        Finish the work here, then return to the task kiosk and tap Complete.

      </div>

      <button type="button" style={styles.button} onClick={handleReturn}>

        Back to task

      </button>

    </div>

  );

};



const styles = {

  bar: {

    display: 'flex',

    alignItems: 'center',

    justifyContent: 'space-between',

    gap: TavariStyles.spacing.md,

    flexWrap: 'wrap',

    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,

    marginBottom: TavariStyles.spacing.md,

    backgroundColor: '#ecfdf5',

    border: '1px solid #6ee7b7',

    borderRadius: TavariStyles.borderRadius.md,

    color: '#065f46'

  },

  text: {

    fontSize: TavariStyles.typography.fontSize.sm,

    lineHeight: TavariStyles.typography.lineHeight.relaxed,

    flex: '1 1 240px'

  },

  button: {

    ...TavariStyles.components.button.base,

    ...TavariStyles.components.button.variants.primary,

    ...TavariStyles.components.button.sizes.sm,

    whiteSpace: 'nowrap'

  }

};



export default TaskReturnBar;

