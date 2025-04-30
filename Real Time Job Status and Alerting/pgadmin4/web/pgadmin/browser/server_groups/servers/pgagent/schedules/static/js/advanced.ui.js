import gettext from 'sources/gettext';
import { BaseUISchema } from '../../../../../../../static/js/SchemaView';
import { WEEKDAYS, OCCURRENCE } from '../../../../../../static/js/constants';


const BooleanArrayFormatter = {
  fromRaw: (originalValue, options) => {
    if (!_.isNull(originalValue) && !_.isUndefined(originalValue) && Array.isArray(originalValue)) {
      let retValue = [],
        index = 0;
      originalValue.forEach( function (value) {
        if (value) {
          retValue.push(options[index]);
        }
        index = index + 1;
      });

      return retValue;
    }

    return originalValue;
  },

  toRaw: (selectedVal, options)=> {
    if (!_.isNull(options) && !_.isUndefined(options) && Array.isArray(options)) {
      let retValue = [];
      options.forEach( function (option) {
        let elementFound = _.find(selectedVal, (selVal)=>_.isEqual(selVal.label, option.label));
        if(_.isUndefined(elementFound)) {
          retValue.push(false);
        } else {
          retValue.push(true);
        }
      });

      return retValue;
    }

    return selectedVal;
  }
};

export class OccurrenceSchema extends BaseUISchema {
  constructor(initValues={}, schemaConfig={
    weekdays: {}, occurrence: {}
  }) {
    super({
      jscweekdays: _.map(WEEKDAYS, function() { return false; }),
      jscoccurrence: _.map(OCCURRENCE, function() { return false; }),
      ...initValues,
    });

    this.schemaConfig = schemaConfig;
  }

  get baseFields() {
    return [
      {
        id: 'jscweekdays', label: gettext('Week Days'), type: 'select',
        group: gettext('Days'),
        deps: ['jscalternate', 'jscinterval'],
        disabled: (state) => state.jscalternate || state.jscinterval > 0,
        controlProps: { allowClear: true, multiple: true, allowSelectAll: true,
          placeholder: gettext('Select the weekdays...'),
          formatter: BooleanArrayFormatter,
        },
        options: WEEKDAYS, ...(this.schemaConfig.weekdays??{})
      }, {
        id: 'jscoccurrence', label: gettext('Occurrence'), type: 'select',
        group: gettext('Days'),
        deps: ['jscalternate', 'jscinterval'],
        disabled: (state) => state.jscalternate || state.jscinterval > 0 ,
        controlProps: { allowClear: true, multiple: true, allowSelectAll: true,
          placeholder: gettext('Select the occurrence...'),
          formatter: BooleanArrayFormatter,
        },
        options: OCCURRENCE, ...(this.schemaConfig.occurrence??{})
      }
    ];
  }
}

export class IntervalSchema extends BaseUISchema {
  constructor(initValues={}) {
    super({
      jscalternate: false,
      jscinterval: 0,
      ...initValues,
    });
  }

  get baseFields() {
    return [
      {
        id: 'jscalternate', 
        label: gettext('Alternate Day'), 
        type: 'switch',
        cell: 'switch',
        group: gettext('Interval'),
        helpMessage: gettext('Enable this to run the job on alternate days'),
        helpMessageMode: ['edit', 'create'],
        deps: ['jscinterval'],
        disabled: (state) => state.jscinterval > 0,
        depChange: (state) => {
          if (state.jscalternate) {
            return {
              jscweekdays: _.map(WEEKDAYS, function() { return false; }),
              jscoccurrence: _.map(OCCURRENCE, function() { return false; })
            };
          }
        }
      }, {
        id: 'jscinterval',
        label: gettext('Interval'),
        type: 'int',
        group: gettext('Interval'),
        min: 1,
        max: 100,
        helpMessage: gettext('Enter the interval between runs'),
        helpMessageMode: ['edit', 'create'],
        deps: ['jscalternate'],
        disabled: (state) => state.jscalternate,
        depChange: (state) => {
          if (state.jscinterval > 0) {
            return {
              jscalternate: false,
              jscweekdays: _.map(WEEKDAYS, function() { return false; }),
              jscoccurrence: _.map(OCCURRENCE, function() { return false; })
            };
          }
        }
      }
    ];
  }
}
  
export class DSTSchema extends BaseUISchema {
  constructor(initValues = {}) {
    super({
      jscdst: false,             // DST disabled by default
      jscdststart: null,         // No start date initially
      jscdstend: null,           // No end date initially
      ...initValues,             // Override with any provided values
    });
  }
  
  get baseFields() {
    return [
      {
        id: 'jscdst', 
        label: gettext('Enable DST?'),
        order: 0, 
        type: 'switch',
        cell: 'switch',
        group: gettext('DST'),
        helpMessage: gettext('Enable this to enable Daylight Saving Time'),
        helpMessageMode: ['edit', 'create'],
      },{
        id: 'jscdststart',
        label: gettext('Start Date'),
        order: 1,
        type: 'datetimepicker', 
        cell: 'datetimepicker',
        deps: ['jscdst'],
        disabled: (state) => !state.jscdst,
        controlProps: { ampm: false,
          placeholder: gettext('YYYY-MM-DD HH:mm:ss Z'), autoOk: true,
          disablePast: true,
        },
      }, {
        id: 'jscdstend', 
        label: gettext('End Date'), 
        order: 2,
        type: 'datetimepicker', 
        cell: 'datetimepicker',
        deps: ['jscdst'],
        disabled: (state) => !state.jscdst,
        controlProps: { ampm: false,
          placeholder: gettext('YYYY-MM-DD HH:mm:ss Z'), autoOk: true,
          disablePast: true,
        }
      }
    ];
  }

  validate(state, setError) {
    let err = false;

    // If DST is enabled, both start and end dates must be provided
    if (state.jscdst) {
      if (!state.jscdststart) {
        setError('jscdststart', gettext('Start date is required when DST is enabled'));
        err = true;
      }
      if (!state.jscdstend) {
        setError('jscdstend', gettext('End date is required when DST is enabled'));
        err = true;
      }
      
      // Additional validation: end date must be after start date
      if (state.jscdststart && state.jscdstend && state.jscdstend <= state.jscdststart) {
        setError('jscdstend', gettext('End date must be after start date'));
        err = true;
      }
    }

    return err;
  }
}