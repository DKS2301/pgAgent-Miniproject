/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

/* The DataGridView component is based on react-table component */

import { DataGridFormHeader } from './formHeader.jsx';
import { DataGridHeader } from './header.jsx';
import { getMappedCell } from './mappedCell.jsx';
import DataGridView from './grid.jsx';


export default DataGridView;

export {
  DataGridFormHeader,
  DataGridHeader,
  getMappedCell,
};
