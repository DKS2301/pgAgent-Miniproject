/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import gettext from 'sources/gettext';
import BaseUISchema from 'sources/SchemaView/base_schema.ui';

export default class PgaJobDependencySchema extends BaseUISchema {
  constructor(fieldOptions={}, initValues={}) {
    super({
      dependent_jobid: undefined,
      dependent_jobname: '',
      original_dependent_jobid: undefined,
      ...initValues,
    });

    this.fieldOptions = {
      jobs: [],
      ...fieldOptions,
    };
  }

  get baseFields() {
    return [
      {
        id: 'original_dependent_jobid',
        label: gettext('Original Dependent Job ID'),
        type: 'text',
        visible: false,
      },
      {
        id: 'dependent_jobid', label: gettext('Dependent Job'), 
        type: 'select', cell: 'select',
        options: this.fieldOptions.jobs,
        controlProps: {allowClear: false},
        noEmpty: true,
        mode: ['create', 'edit', 'properties'],
        helpMessage: gettext('Select the job that must complete before this job can run.'),
        helpMessageMode: ['create', 'edit', 'properties'],
      },
      {
        id: 'dependent_jobname', label: gettext('Dependent Job Name'), type: 'text',
        readonly: true,
        visible: false,
      }
    ];
  }
} 